"use server";
import "server-only";

import { getCurrentUser } from "@/features/auth-page/helpers";
import { CHAT_DEFAULT_SYSTEM_PROMPT } from "@/features/theme/theme-config";
import { CreateChatMessage } from "../chat-message-service";
import { EnsureChatThreadOperation } from "../chat-thread-service";
import { UserPrompt, MODEL_CONFIGS, ChatThreadModel } from "../models";
import { mapOpenAIChatMessages } from "../utils";
import { FindTopChatMessagesForCurrentUser } from "../chat-message-service";
import { 
  getAvailableFunctions, 
  executeFunction, 
  registerDynamicFunction, 
  FunctionCall,
  getToolByName
} from "./function-registry";
import { OpenAIResponsesStream } from "./openai-responses-stream";
import { createConversationState, startConversation, continueConversation, ConversationState } from "./conversation-manager";
import { FindAllExtensionForCurrentUserAndIds, FindSecureHeaderValue } from "@/features/extensions-page/extension-services/extension-service";
import { reportUserChatMessage } from "@/features/common/services/chat-metrics-service";
import { FindAllChatDocuments } from "../chat-document-service";
import { logDebug, logInfo, logError } from "@/features/common/services/logger";

export const ChatAPIResponse = async (props: UserPrompt, signal: AbortSignal) => {
  // Get current chat thread
  const currentChatThreadResponse = await EnsureChatThreadOperation(props.id);
  if (currentChatThreadResponse.status !== "OK") {
    return new Response("Unauthorized", { status: 401 });
  }

  const currentChatThread = currentChatThreadResponse.response;
  const selectedModel = props.selectedModel || "gpt-5";
  const modelConfig = MODEL_CONFIGS[selectedModel];
  const reasoningEffort = props.reasoningEffort || "medium";

  // Validate model configuration
  if (!modelConfig?.deploymentName) {
    logError("Missing deployment configuration", { 
      selectedModel, 
      availableModels: Object.keys(MODEL_CONFIGS) 
    });
    return new Response(`Missing deployment configuration for model ${selectedModel}`, { status: 500 });
  }

  // Get OpenAI instance
  let openaiInstance;
  try {
    openaiInstance = modelConfig.getInstance();
  } catch (error) {
    logError("Failed to create OpenAI instance", { 
      selectedModel, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return new Response(`Failed to initialize AI service for model ${selectedModel}`, { status: 500 });
  }

  // Get user and history in parallel
  const [user, history] = await Promise.all([
    getCurrentUser(),
    _getHistory(currentChatThread),
  ]);

  // Check if documents are attached to this chat thread
  const documentsResponse = await FindAllChatDocuments(currentChatThread.id);
  const hasDocuments = documentsResponse.status === "OK" && documentsResponse.response.length > 0;
  
  // Build document hint if documents are attached
  let documentHint = "";
  if (hasDocuments) {
    const documentNames = documentsResponse.response.map(doc => doc.name).join(", ");
    documentHint = `\n\nDOCUMENT CONTEXT: The user has attached the following document(s) to this conversation: ${documentNames}. You can search and reference this document content using the search_documents function when the user asks questions about the document or its content.`;
  }

  // Update system prompt with current date and document hint
  currentChatThread.personaMessage = `${CHAT_DEFAULT_SYSTEM_PROMPT} \n\nToday's Date: ${new Date().toLocaleString()}${documentHint}\n\n${currentChatThread.personaMessage}`;

  // Save user message
  await CreateChatMessage({
    name: user.name,
    content: props.message,
    role: "user",
    chatThreadId: currentChatThread.id,
    multiModalImage: props.multimodalImage,
  });

  // Get available functions (built-in + dynamic extensions)
  const { tools, extensionHeaders } = await _getAvailableTools(currentChatThread);
  
  // Add search_documents tool if documents are attached
  if (hasDocuments) {
    const searchDocumentsTool = await getToolByName("search_documents");
    if (searchDocumentsTool) {
      tools.push(searchDocumentsTool);
      logInfo("Added search_documents function (document search)");
    }
  }

  // Create request options for Responses API
  const requestOptions: any = {
    model: modelConfig.deploymentName,
    stream: true,
    store: false,
    tools: tools,
    tool_choice: "auto", // Let the model decide when to use tools
    parallel_tool_calls: true, // Allow parallel tool calls
  };

  // Add reasoning configuration for reasoning models
  if (modelConfig?.supportsReasoning) {
    requestOptions.reasoning = {
      effort: reasoningEffort,
      summary: "auto"
    };
    logInfo("Using reasoning model", { selectedModel, reasoningEffort });
  }

  logInfo("Starting chat with streaming function calling", {
    model: selectedModel,
    toolsCount: tools.length,
    hasReasoning: !!requestOptions.reasoning,
    messageLength: props.message.length
  });
  logDebug("User message preview", { preview: props.message.substring(0, 200) + "..." });

  // Create conversation manager with context
  const conversationContext = {
    threadId: currentChatThread.id,
    userMessage: props.message,
    signal: signal,
    openaiInstance: openaiInstance,
    requestOptions: requestOptions,
    headers: extensionHeaders, // Pass extension headers to conversation context
  };

  // Build initial conversation input
  const initialInput = [
    {
      type: "message" as const,
      role: "system" as const,
      content: currentChatThread.personaMessage,
    },
    ...history.map((msg: any) => ({
      type: "message" as const,
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    })),
  ];

  // Handle multimodal input for the user message
  if (props.multimodalImage) {
    initialInput.push({
      type: "message" as const,
      role: "user" as const,
      content: [
        { type: "input_text", text: props.message },
        { type: "input_image", image_url: props.multimodalImage }
      ]
    } as any);
  } else {
    initialInput.push({
      type: "message" as const,
      role: "user" as const,
      content: props.message,
    });
  }

  // Create conversation state and start the conversation
  const conversationState = await createConversationState(conversationContext, initialInput);
  const stream = await startConversation(conversationState);

  // Create a conversation orchestrator that handles stream continuation
  const readableStream = new ReadableStream({
    async start(controller) {
      let currentState = conversationState;
      let currentStream = stream;
      let isFinished = false;
      
      while (!isFinished) {
        try {
          logDebug("Processing conversation stream");
          
          const responseStream = OpenAIResponsesStream({
            stream: currentStream,
            chatThread: currentChatThread,
            conversationState: currentState,
            onContinue: async (updatedState: ConversationState) => {
              logDebug("Function calls complete, will continue conversation");
              currentState = updatedState;
            },
            onComplete: async () => {
              logInfo("Conversation completed");
              isFinished = true;
            }
          });
          
          // Pipe the response stream to the main controller
          const reader = responseStream.getReader();
          let streamEnded = false;
          
          while (!streamEnded && !isFinished) {
            const { done, value } = await reader.read();
            if (done) {
              streamEnded = true;
              break;
            }
            controller.enqueue(value);
          }
          
          reader.releaseLock();
          
          // If not finished but stream ended, it means we need to continue
          if (!isFinished && streamEnded) {
            logDebug("Starting continuation stream", {
              currentStateMessageId: currentState.messageId,
              conversationInputLength: currentState.conversationInput.length
            });
            currentStream = await continueConversation(currentState);
          }
          
        } catch (error) {
          logError("Stream processing error", { 
            error: error instanceof Error ? error.message : String(error),
            isFinished
          });
          controller.error(error);
          return;
        }
      }
      
      logDebug("All streams completed, closing controller");
      controller.close();
    }
  });

  // Report user message
  reportUserChatMessage(selectedModel, {
    personaMessageTitle: currentChatThread.personaMessageTitle,
    threadId: currentChatThread.id,
  });

  return new Response(readableStream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};

// Helper function to get chat history
async function _getHistory(chatThread: ChatThreadModel) {
  const historyResponse = await FindTopChatMessagesForCurrentUser(chatThread.id);
    if (historyResponse.status === "OK") {
    const historyResults = historyResponse.response;
    const mappedHistory = await mapOpenAIChatMessages(historyResults);
    return mappedHistory.reverse();
  }
  
  logError("Error getting history", { errors: historyResponse.errors });
  return [];
}

// Helper function to get available tools
async function _getAvailableTools(chatThread: ChatThreadModel) {
  const tools = [];
  const extensionHeaders: Record<string, string> = {};
  
  logInfo("Chat thread extensions", { extensions: chatThread.extension?.join(", ") || "none" });
  
  // Always add create_image function (core feature) - only this specific function
  const builtInFunctions = await getAvailableFunctions();
  const createImageFunction = builtInFunctions.find(f => f.name === "create_image");
  if (createImageFunction) {
    tools.push(createImageFunction);
    logInfo("Added create_image function (core feature)");
  }
  
  // Add dynamic extensions ONLY if they are configured for this chat thread
  if (chatThread.extension && chatThread.extension.length > 0) {
    const extensionResponse = await FindAllExtensionForCurrentUserAndIds(chatThread.extension);
    
    if (extensionResponse.status === "OK") {
      // Filter extensions to only include those that are configured for this chat thread
      const configuredExtensions = extensionResponse.response.filter(extension => 
        chatThread.extension.includes(extension.id)
      );
      
      logInfo("Found extensions", { 
        totalExtensions: extensionResponse.response.length, 
        configuredExtensions: configuredExtensions.length 
      });
      
      for (const extension of configuredExtensions) {
        for (const functionDef of extension.functions) {
          try {
            const parsedFunction = JSON.parse(functionDef.code);
            
            // Resolve headers from Key Vault
            const resolvedHeaders: Record<string, string> = {};
            for (const header of extension.headers) {
              const headerValueResponse = await FindSecureHeaderValue(header.id);
              if (headerValueResponse.status === "OK") {
                resolvedHeaders[header.key] = headerValueResponse.response;
                // Store headers for later use in conversation context
                extensionHeaders[header.key] = headerValueResponse.response;
              } else {
                logError("Failed to resolve header", { 
                  headerKey: header.key, 
                  errors: headerValueResponse.errors 
                });
              }
            }
            
            // Register the dynamic function
            const dynamicFunction = await registerDynamicFunction(
              parsedFunction.name,
              parsedFunction.description,
              parsedFunction.parameters,
              functionDef.endpoint,
              functionDef.endpointType,
              resolvedHeaders
            );
            
            tools.push(dynamicFunction);
            logInfo("Registered dynamic function", { functionName: parsedFunction.name });
          } catch (error) {
            logError("Failed to register extension function", { 
              error: error instanceof Error ? error.message : String(error) 
            });
          }
        }
      }
    }
  }

  logInfo("Available tools", { toolNames: tools.map(t => t.name).join(", ") });
  return { tools, extensionHeaders };
}
