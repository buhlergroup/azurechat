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
  FunctionCall 
} from "./function-registry";
import { OpenAIResponsesStream } from "./openai-responses-stream";
import { createConversationState, startConversation, continueConversation, ConversationState } from "./conversation-manager";
import { FindAllExtensionForCurrentUserAndIds, FindSecureHeaderValue } from "@/features/extensions-page/extension-services/extension-service";
import { reportUserChatMessage } from "@/features/common/services/chat-metrics-service";
import { FindAllChatDocuments } from "../chat-document-service";

export const ChatAPIResponse = async (props: UserPrompt, signal: AbortSignal) => {
  // Get current chat thread
  const currentChatThreadResponse = await EnsureChatThreadOperation(props.id);
  if (currentChatThreadResponse.status !== "OK") {
    return new Response("Unauthorized", { status: 401 });
  }

  const currentChatThread = currentChatThreadResponse.response;
  const selectedModel = props.selectedModel || "gpt-4.1";
  const modelConfig = MODEL_CONFIGS[selectedModel];
  const reasoningEffort = props.reasoningEffort || "medium";

  // Validate model configuration
  if (!modelConfig?.deploymentName) {
    console.error("🔴 Missing deployment configuration", { 
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
    console.error("🔴 Failed to create OpenAI instance", { 
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

  // Update system prompt with current date
  currentChatThread.personaMessage = `${CHAT_DEFAULT_SYSTEM_PROMPT} \n\nToday's Date: ${new Date().toLocaleString()}\n\n${currentChatThread.personaMessage}`;

  // Save user message
  await CreateChatMessage({
    name: user.name,
    content: props.message,
    role: "user",
    chatThreadId: currentChatThread.id,
    multiModalImage: props.multimodalImage,
  });

  // Get available functions (built-in + dynamic extensions)
  const tools = await _getAvailableTools(currentChatThread);

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
    console.info("🧠 Using reasoning model", { selectedModel, reasoningEffort });
  }

  console.info("🚀 Starting chat with streaming function calling", {
    model: selectedModel,
    toolsCount: tools.length,
    hasReasoning: !!requestOptions.reasoning,
    messageLength: props.message.length
  });
  console.debug("🚀 User message preview:", props.message.substring(0, 200) + "...");

  // Create conversation manager with context
  const conversationContext = {
    threadId: currentChatThread.id,
    userMessage: props.message,
    signal: signal,
    openaiInstance: openaiInstance,
    requestOptions: requestOptions,
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
      content: msg.content,
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
          console.debug("🔄 Processing conversation stream...");
          
          const responseStream = OpenAIResponsesStream({
            stream: currentStream,
            chatThread: currentChatThread,
            conversationState: currentState,
            onContinue: async (updatedState: ConversationState) => {
              console.debug("🔄 Function calls complete, will continue conversation");
              currentState = updatedState;
            },
            onComplete: async () => {
              console.info("✅ Conversation completed");
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
            console.debug("🔄 Starting continuation stream...", {
              currentStateMessageId: currentState.messageId,
              conversationInputLength: currentState.conversationInput.length
            });
            currentStream = await continueConversation(currentState);
          }
          
        } catch (error) {
          console.error("🔴 Stream processing error:", { 
            error: error instanceof Error ? error.message : String(error),
            isFinished
          });
          controller.error(error);
          return;
        }
      }
      
      console.debug("✅ All streams completed, closing controller");
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
    return mapOpenAIChatMessages(historyResults).reverse();
  }
  
  console.error("🔴 Error getting history:", historyResponse.errors);
  return [];
}

// Helper function to get available tools
async function _getAvailableTools(chatThread: ChatThreadModel) {
  const tools = [];
  
  console.log(`🔧 Chat thread extensions: ${chatThread.extension?.join(", ") || "none"}`);
  
  // Always add create_image function (core feature) - only this specific function
  const builtInFunctions = await getAvailableFunctions();
  const createImageFunction = builtInFunctions.find(f => f.name === "create_image");
  if (createImageFunction) {
    tools.push(createImageFunction);
    console.log(`🎨 Added create_image function (core feature)`);
  }
  
  // Add dynamic extensions ONLY if they are configured for this chat thread
  if (chatThread.extension && chatThread.extension.length > 0) {
    const extensionResponse = await FindAllExtensionForCurrentUserAndIds(chatThread.extension);
    
    if (extensionResponse.status === "OK") {
      // Filter extensions to only include those that are configured for this chat thread
      const configuredExtensions = extensionResponse.response.filter(extension => 
        chatThread.extension.includes(extension.id)
      );
      
      console.log(`🔧 Found ${extensionResponse.response.length} total extensions, using ${configuredExtensions.length} configured for this chat thread`);
      
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
              } else {
                console.error(`🔴 Failed to resolve header ${header.key}:`, headerValueResponse.errors);
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
            console.log(`📁 Registered dynamic function: ${parsedFunction.name}`);
          } catch (error) {
            console.error(`🔴 Failed to register extension function:`, error);
          }
        }
      }
    }
  }

  console.log(`🔧 Available tools: ${tools.map(t => t.name).join(", ")}`);
  return tools;
}
