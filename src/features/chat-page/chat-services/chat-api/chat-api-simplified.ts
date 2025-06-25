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
import { FindAllExtensionForCurrentUserAndIds } from "@/features/extensions-page/extension-services/extension-service";
import { reportUserChatMessage } from "@/features/common/services/chat-metrics-service";

export const ChatAPISimplified = async (props: UserPrompt, signal: AbortSignal) => {
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
    console.error(`🔴 Missing deployment name for model ${selectedModel}`);
    return new Response(`Missing deployment configuration for model ${selectedModel}`, { status: 500 });
  }

  // Get OpenAI instance
  let openaiInstance;
  try {
    openaiInstance = modelConfig.getInstance();
  } catch (error) {
    console.error(`🔴 Failed to create OpenAI instance for model ${selectedModel}:`, error);
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

  // Build input messages for Responses API
  const inputMessages = _buildInputMessages({
    chatThread: currentChatThread,
    history: history,
    userMessage: props.message,
    multiModalImage: props.multimodalImage,
  });  // Create request options for Responses API
  const requestOptions: any = {
    model: modelConfig.deploymentName,
    input: inputMessages,
    stream: true,
    store: false,
    tools: tools,
    tool_choice: "auto", // Let the model decide when to use tools
    parallel_tool_calls: false, // Disable parallel tool calls to ensure sequential execution
  };

  // Add reasoning configuration for reasoning models
  if (modelConfig?.supportsReasoning) {
    requestOptions.reasoning = {
      effort: reasoningEffort,
      summary: "auto"
    };
    console.log(`🧠 Using reasoning model ${selectedModel} with effort: ${reasoningEffort}`);
  }

  console.log("🚀 Starting chat with simplified function calling", {
    model: selectedModel,
    toolsCount: tools.length,
    hasReasoning: !!requestOptions.reasoning,
    userMessage: props.message.substring(0, 100) + "..."
  });
  
  // Conversation loop approach:
  // Keep the conversation going until no more function calls are needed
  let conversationInput = inputMessages;
  let finalStream = null;
  
  if (tools.length > 0) {
    console.log("🔧 Starting conversation loop with function calling support");
    
    try {
      while (true) {
        // Make API call to continue the conversation
        const response = await openaiInstance.responses.create({
          ...requestOptions,
          input: conversationInput,
          stream: false, // Non-streaming for conversation management
        }, { signal });
        
        // Check if function calls were made
        const functionCalls = response.output?.filter((item: any) => item.type === "function_call") || [];
        
        if (functionCalls.length > 0) {
          console.log(`🔧 Processing ${functionCalls.length} function call(s) in conversation turn`);
          
          // Add the assistant's response (including function calls) to the conversation
          conversationInput = [...conversationInput, ...response.output];
          
          // Execute each function call and add results to conversation
          for (const functionCallItem of functionCalls) {
            const functionCall: FunctionCall = {
              name: functionCallItem.name,
              arguments: JSON.parse(functionCallItem.arguments),
              call_id: functionCallItem.call_id,
            };

            console.log(`🔧 Executing function: ${functionCall.name}`, functionCall.arguments);

            try {
              const result = await executeFunction(functionCall, {
                threadId: currentChatThread.id,
                userMessage: props.message,
                signal: signal,
              });

              console.log(`✅ Function result for ${functionCall.name}:`, result.output.substring(0, 200));

              // Add function result to conversation
              conversationInput.push({
                type: "function_call_output" as any,
                call_id: functionCall.call_id,
                output: result.output
              } as any);

            } catch (error) {
              console.error(`🔴 Function execution failed for ${functionCall.name}:`, error);
              
              // Add error result to conversation
              conversationInput.push({
                type: "function_call_output" as any,
                call_id: functionCall.call_id,
                output: JSON.stringify({ error: `Function execution failed: ${error}` })
              } as any);
            }
          }
          
          // Continue the loop to let LLM process function results
          console.log("🔄 Continuing conversation with function results");
          
        } else {
          // No function calls - conversation is complete, now stream the final response
          console.log("✅ No more function calls needed, streaming final response");
          finalStream = await openaiInstance.responses.create({
            ...requestOptions,
            input: conversationInput,
            stream: true, // Now enable streaming for the final response
            tools: [], // Remove tools to prevent further function calls
          }, { signal });
          break;
        }
      }
      
    } catch (error) {
      console.error("🔴 Error in conversation loop:", error);
      // Fallback to streaming without tools
      finalStream = await openaiInstance.responses.create({
        ...requestOptions,
        input: conversationInput,
        stream: true,
        tools: [],
      }, { signal });
    }
  } else {
    // No tools available, just stream directly
    console.log("🚀 No tools available, streaming response directly");
    finalStream = await openaiInstance.responses.create({
      ...requestOptions,
      stream: true
    }, { signal });
  }

  // Create readable stream for response
  const readableStream = OpenAIResponsesStream({
    stream: finalStream,
    chatThread: currentChatThread,
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
  // Add built-in functions
  const builtInFunctions = await getAvailableFunctions();
  tools.push(...builtInFunctions);

  // Add dynamic extensions if any are configured
  if (chatThread.extension && chatThread.extension.length > 0) {
    const extensionResponse = await FindAllExtensionForCurrentUserAndIds(chatThread.extension);
    
    if (extensionResponse.status === "OK") {
      for (const extension of extensionResponse.response) {
        for (const functionDef of extension.functions) {
          try {
            const parsedFunction = JSON.parse(functionDef.code);
            
            // Register the dynamic function
            const dynamicFunction = await registerDynamicFunction(
              parsedFunction.name,
              parsedFunction.description,
              parsedFunction.parameters,
              functionDef.endpoint,
              functionDef.endpointType,
              extension.headers.reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {})
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

// Helper function to build input messages
function _buildInputMessages(props: {
  chatThread: ChatThreadModel;
  history: any[];
  userMessage: string;
  multiModalImage?: string;
}) {
  const { chatThread, history, userMessage, multiModalImage } = props;

  const inputMessages = [
    {
      type: "message" as const,
      role: "system" as const,
      content: chatThread.personaMessage,
    },
    ...history.map((msg: any) => ({
      type: "message" as const,
      role: msg.role,
      content: msg.content,
    })),
  ];

  // Handle multimodal input
  if (multiModalImage) {
    inputMessages.push({
      type: "message" as const,
      role: "user" as const,
      content: [
        { type: "input_text", text: userMessage },
        { type: "input_image", image_url: multiModalImage }
      ]
    });
  } else {
    inputMessages.push({
      type: "message" as const,
      role: "user" as const,
      content: userMessage,
    });
  }
  return inputMessages;
}
