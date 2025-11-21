import { AI_NAME } from "@/features/theme/theme-config";
import { uniqueId } from "@/features/common/util";
import { CreateChatMessage, UpsertChatMessage } from "../chat-message-service";
import { logDebug, logInfo, logError, logWarn } from "@/features/common/services/logger";
import {
  AzureChatCompletion,
  AzureChatCompletionAbort,
  AzureChatCompletionReasoning,
  AzureChatCompletionFunctionCall,
  AzureChatCompletionFunctionCallResult,
  ChatThreadModel,
  ChatMessageModel,
  MESSAGE_ATTRIBUTE,
} from "../models";
import { 
  reportCompletionTokens, 
  reportPromptTokens 
} from "@/features/common/services/chat-metrics-service";
import { userHashedId } from "@/features/auth-page/helpers";
import { 
  createConversationState, 
  processFunctionCall, 
  continueConversation,
  ConversationState 
} from "./conversation-manager";
import { Stream } from "openai/core/streaming";
import { ResponseStreamEvent } from "openai/resources/responses/responses";

export const OpenAIResponsesStream = (props: {
  stream: Stream<ResponseStreamEvent>;
  chatThread: ChatThreadModel;
  conversationState?: ConversationState;
  onComplete?: () => Promise<void>;
  onContinue?: (updatedState: ConversationState) => Promise<void>;
}) => {
  const encoder = new TextEncoder();
  const { stream, chatThread, conversationState, onComplete, onContinue } = props;

  // Helper function to save message (including tool call history)
  const saveMessage = async (
    messageId: string,
    content: string,
    reasoningContent: string,
    chatThread: ChatThreadModel,
    toolCallHistory?: Array<{ name: string; arguments: string; result?: string; timestamp: Date }>,
    reasoningState?: any
  ) => {
    
    const messageToSave: ChatMessageModel = {
      id: messageId,
      name: AI_NAME,
      content: content,
      role: "assistant",
      threadId: chatThread.id,
      reasoningContent: reasoningContent || undefined,
      createdAt: new Date(),
      isDeleted: false,
      userId: await userHashedId(),
      type: MESSAGE_ATTRIBUTE,
      toolCallHistory: toolCallHistory && toolCallHistory.length > 0 ? toolCallHistory : undefined,
      reasoningState: reasoningState || undefined,
    };
    
    await UpsertChatMessage(messageToSave);
    logDebug("Message saved", { 
      messageId, 
      contentLength: content.length,
      threadId: chatThread.id 
    });
  };

  // Helper function to handle response completion
  const handleResponseCompletion = async (
    event: any, 
    lastMessage: string, 
    reasoningContent: string, 
    reasoningSummaries: Record<number, string>, 
    messageId: string, 
    chatThread: ChatThreadModel, 
    controller: ReadableStreamDefaultController, 
    streamResponse: (event: string, value: string) => void
  ) => {
    logInfo("Response completion handler called", { 
      eventType: event.type,
      messageLength: lastMessage?.length || 0,
      hasReasoning: !!reasoningContent
    });
    
    // For response.completed events, the final content is already accumulated in lastMessage
    // The event.response.output contains the final structured output, but we've been
    // building the text content incrementally through delta events
    const encryptedReasoning = event.response?.output
      ?.find((item: any) => item.type === "reasoning");
    const messageOutput = event.response?.output?.find((item: any) => item.type === "message");
    const originalMessageId = messageOutput?.id || messageId;

    const finalReasoningContent = Object.keys(reasoningSummaries).length > 0 
      ? Object.values(reasoningSummaries).join('\n\n') 
      : reasoningContent;

    // Save message to database
    await saveMessage(originalMessageId, lastMessage, finalReasoningContent, chatThread, undefined, encryptedReasoning);

    // Report token usage
    if (event.response?.usage) {
      const { input_tokens, output_tokens, total_tokens } = event.response.usage;
      logInfo("Token usage", { 
        inputTokens: input_tokens,
        outputTokens: output_tokens,
        totalTokens: total_tokens
      });
      
      await reportCompletionTokens(output_tokens, chatThread.selectedModel || "gpt-4o", {
        personaMessageTitle: chatThread.personaMessageTitle,
        threadId: chatThread.id,
        messageId: originalMessageId,
        totalTokens: total_tokens,
        inputTokens: input_tokens
      });

      await reportPromptTokens(input_tokens, chatThread.selectedModel || "gpt-4o", "user", {
        personaMessageTitle: chatThread.personaMessageTitle,
        threadId: chatThread.id,
        messageId: originalMessageId
      });
    }

    // Send final response and close
    const finalResponse: AzureChatCompletion = {
      type: "finalContent",
      response: lastMessage,
    };
    logInfo("Sending finalContent event to frontend", {
      messageLength: lastMessage.length,
      responseType: finalResponse.type,
      responseData: JSON.stringify(finalResponse)
    });
    streamResponse(finalResponse.type, JSON.stringify(finalResponse));
    
    // Ensure the stream is flushed before closing by yielding to the event loop
    await Promise.resolve();
    
    // Add a longer delay to ensure the frontend has time to process the finalContent event
    logDebug("Waiting for frontend to process finalContent event");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Signal completion
    if (onComplete) {
      await onComplete();
    }
    
    // Ensure the stream is fully flushed before closing
    logDebug("Flushing stream before closing");
    await new Promise(resolve => setTimeout(resolve, 100));
    
    logDebug("Closing stream controller");
    controller.close();
  };

  const readableStream = new ReadableStream({
    async start(controller) {

      const streamResponse = (event: string, value: string) => {
        if (controller.desiredSize !== null) {
          const eventData = `event: ${event} \n`;
          const dataData = `data: ${value} \n\n`;
          logDebug("Backend: Sending SSE event", {
            eventType: event,
            dataLength: value.length,
            dataPreview: value.substring(0, 200) + "..."
          });
          controller.enqueue(encoder.encode(eventData));
          controller.enqueue(encoder.encode(dataData));
        }
      };      
      
      let lastMessage = "";
      let reasoningContent = "";
      let reasoningSummaries: Record<number, string> = {};
      let messageSaved = false;
      let functionCalls: Record<number, any> = {}; // Track function calls per output index
      let toolCallHistory: Array<{ name: string; arguments: string; result?: string; timestamp: Date; call_id?: string }> = [];
      let currentConversationState = conversationState; // Use passed conversation state
      // Use a consistent message ID across the entire conversation
      const messageId = conversationState?.messageId || uniqueId();
      logDebug("OpenAI Responses Stream: Using message ID", {
        messageId,
        hasConversationState: !!conversationState,
        conversationStateMessageId: conversationState?.messageId
      });

      try {
        for await (const event of stream) {
          // Log event type and basic info
          logDebug("SSE event", { eventType: event.type });

          switch (event.type) {
            case "response.created":
              logDebug("Response created");
              break;

            case "response.incomplete": {
              // The model ended the response early; capture the reason and surface to UI
              const reason = (event as any)?.response?.incomplete_details?.reason || (event as any)?.incomplete_details?.reason || "unknown";
              logWarn("Received response.incomplete", { reason });

              // Save any partial content we have so far
              if (lastMessage && !messageSaved) {
                try {
                  await saveMessage(messageId, lastMessage, reasoningContent, chatThread, toolCallHistory);
                  messageSaved = true;
                } catch (persistError) {
                  logWarn("Failed to persist partial message on incomplete", { error: persistError instanceof Error ? persistError.message : String(persistError) });
                }
              }

              // Map the reason to a short, user-friendly message
              const reasonMessageMap: Record<string, string> = {
                max_output_tokens: "The model reached the maximum output tokens limit.",
                content_filter: "The response was stopped by a content filter.",
                server_error: "The server encountered an error while generating the response.",
                rate_limit: "The request hit a rate limit.",
              };
              const userMessage = reasonMessageMap[reason] || `The response ended early (${reason}).`;

              const abortEvent: AzureChatCompletionAbort = {
                type: "abort",
                response: userMessage,
              };

              // Notify frontend and close the stream
              streamResponse(abortEvent.type, JSON.stringify(abortEvent));

              // Mark conversation as finished
              if (onComplete) {
                await onComplete();
              }

              // Ensure the stream is flushed before closing by yielding to the event loop
              await Promise.resolve();
              controller.close();
              return;
            }

            case "response.output_text.delta":
              // Handle text delta events
              if (event.delta) {
                const deltaContent = event.delta;
                lastMessage += deltaContent;

                const response: AzureChatCompletion = {
                  type: "content",
                  response: {
                    id: messageId,
                    choices: [{
                      message: {
                        content: deltaContent,
                        role: "assistant"
                      }
                    }]
                  },
                };
                streamResponse(response.type, JSON.stringify(response));
              }
              break;

            case "response.output_item.added":
              // Function call started
              if (event.item?.type === "function_call") {
                logInfo("Function call started", { functionName: event.item.name });
                functionCalls[event.output_index] = {
                  ...event.item,
                  arguments: ""
                };
                // Record a started tool call entry (without result yet)
                toolCallHistory.push({
                  name: event.item.name || "",
                  arguments: "",
                  timestamp: new Date(),
                  call_id: event.item.call_id
                });
                
                // Don't stream function call start - wait for completion
              } else if (event.item?.type === "image_generation_call") {
                logInfo("Image generation started", { outputIndex: event.output_index });
                functionCalls[event.output_index] = {
                  type: "image_generation_call",
                  ...event.item
                };
              }
              break;

            case "response.function_call_arguments.delta":
              // Accumulate function arguments
              const index = event.output_index;
              if (functionCalls[index]) {
                functionCalls[index].arguments += event.delta;
                
                // Don't stream function arguments delta - wait for completion
              }
              break;

            case "response.function_call_arguments.done":
              // Function call arguments complete - execute the function
              if (currentConversationState) {
                const completedCall = functionCalls[event.output_index];
                if (completedCall) {
                  // Update the last matching tool call entry with the final arguments
                  for (let i = toolCallHistory.length - 1; i >= 0; i--) {
                    if (!toolCallHistory[i].result && (!toolCallHistory[i].call_id || toolCallHistory[i].call_id === completedCall.call_id)) {
                      toolCallHistory[i].arguments = completedCall.arguments;
                      break;
                    }
                  }
                  // Stream function call info now that it's complete
                  const functionCallResponse: AzureChatCompletionFunctionCall = {
                    type: "functionCall",
                    response: {
                      name: completedCall.name,
                      arguments: completedCall.arguments,
                      call_id: completedCall.call_id,
                    } as any,
                  };
                  streamResponse(functionCallResponse.type, JSON.stringify(functionCallResponse));

                  const result = await processFunctionCall(currentConversationState, {
                    name: completedCall.name,
                    arguments: completedCall.arguments,
                    call_id: completedCall.call_id,
                  });

                  // Update the conversation state
                  currentConversationState = result.updatedState;

                  if (result.success) {
                    // Stream function result
                    const functionResultResponse: AzureChatCompletionFunctionCallResult = {
                      type: "functionCallResult",
                      response: result.result!,
                      // include call_id for client-side matching if needed
                      // @ts-ignore
                      call_id: completedCall.call_id,
                    };
                    streamResponse(functionResultResponse.type, JSON.stringify(functionResultResponse));

                    // Attach result to the last matching tool call entry
                    for (let i = toolCallHistory.length - 1; i >= 0; i--) {
                      if (!toolCallHistory[i].result && (!toolCallHistory[i].call_id || toolCallHistory[i].call_id === completedCall.call_id)) {
                        toolCallHistory[i].result = result.result!;
                        break;
                      }
                    }

                    // Persist tool call as a separate tool message for refresh resilience
                    try {
                      const toolMessage: ChatMessageModel = {
                        id: uniqueId(),
                        name: completedCall.name || "tool",
                        content: JSON.stringify({
                          name: completedCall.name,
                          arguments: completedCall.arguments,
                          result: result.result!,
                          call_id: completedCall.call_id,
                          parentAssistantMessageId: messageId,
                          timestamp: new Date().toISOString(),
                        }),
                        role: "tool",
                        threadId: chatThread.id,
                        createdAt: new Date(),
                        isDeleted: false,
                        userId: await userHashedId(),
                        type: MESSAGE_ATTRIBUTE,
                      };
                      await UpsertChatMessage(toolMessage);
                    } catch (persistError) {
                      logWarn("Failed to persist tool call message", { error: persistError instanceof Error ? persistError.message : String(persistError) });
                    }
                  } else {
                    // Stream function error
                    const functionErrorResponse: AzureChatCompletion = {
                      type: "error",
                      response: result.error!,
                    };
                    streamResponse(functionErrorResponse.type, JSON.stringify(functionErrorResponse));
                  }
                }
              }
              break;

            case "response.output_item.done":
              // Check if this was a function call completion
              if (event.item?.type === "function_call") {
                logInfo("Function call completed", { functionName: event.item.name });
                
                // If we have conversation state and function calls, signal continuation
                if (currentConversationState && Object.keys(functionCalls).length > 0) {
                  logInfo("Function calls complete, signaling for conversation continuation");
                  
                  // Signal that conversation should continue with updated state
                  if (onContinue) {
                    await onContinue(currentConversationState);
                  }
                  
                  // End this stream - the conversation manager will start a new one
                  controller.close();
                  return;
                }
              } else if (event.item?.type === "image_generation_call") {
                logInfo("Image generation completed", { outputIndex: event.output_index });
                // The result is in event.item.result as base64 string
                if (event.item?.result) {
                  try {
                    // Decode base64 image and upload to blob storage
                    const imageName = `${uniqueId()}.png`;
                    const { UploadImageToStore, GetImageUrl } = await import("../chat-image-service");
                    
                    await UploadImageToStore(
                      chatThread.id,
                      imageName,
                      Buffer.from(event.item.result, "base64")
                    );
                    
                    const imageUrl = await GetImageUrl(chatThread.id, imageName);
                    
                    // Add image markdown to the message
                    const imageMarkdown = `\n\n![Generated Image](${imageUrl})\n\n`;
                    lastMessage += imageMarkdown;
                    
                    // Stream the image as content
                    const response: AzureChatCompletion = {
                      type: "content",
                      response: {
                        id: messageId,
                        choices: [{
                          message: {
                            content: imageMarkdown,
                            role: "assistant"
                          }
                        }]
                      },
                    };
                    streamResponse(response.type, JSON.stringify(response));
                    
                    logInfo("Image uploaded and displayed", { imageName, imageUrl });
                  } catch (error) {
                    logError("Failed to process generated image", { 
                      error: error instanceof Error ? error.message : String(error) 
                    });
                  }
                }
              }
              break;

            case "response.reasoning_summary_text.delta":
              if (event.delta) {
                const summaryIndex = event.summary_index || 0;
                reasoningSummaries[summaryIndex] = (reasoningSummaries[summaryIndex] || '') + event.delta;
                
                const reasoningResponse: AzureChatCompletionReasoning = {
                  type: "reasoning",
                  response: event.delta,
                };
                streamResponse(reasoningResponse.type, JSON.stringify(reasoningResponse));
                
                reasoningContent = Object.values(reasoningSummaries).join('\n\n');
              }
              break;

            case "response.image_generation_call.in_progress":
              logDebug("Image generation in progress", { outputIndex: event.output_index });
              break;

            case "response.image_generation_call.generating":
              logDebug("Image generation generating", { outputIndex: event.output_index });
              break;

            case "response.image_generation_call.partial_image":
              // Partial image data available during generation - could be used for progressive loading
              logDebug("Partial image received", { outputIndex: event.output_index });
              break;

            case "response.completed":
              logInfo("Received response.completed event");
              await handleResponseCompletion(event, lastMessage, reasoningContent, reasoningSummaries, messageId, chatThread, controller, streamResponse);
              return;

            case "error":
              logError("Stream error", { 
                errorMessage: (event as any).error?.message || "Unknown error" 
              });
              const errorResponse: AzureChatCompletion = {
                type: "error",
                response: (event as any).error?.message || "Unknown error occurred",
              };

              if (lastMessage && !messageSaved) {
                await saveMessage(messageId, lastMessage, reasoningContent, chatThread);
                messageSaved = true;
              }

              streamResponse(errorResponse.type, JSON.stringify(errorResponse));
              
              // Ensure the stream is flushed before closing by yielding to the event loop
              await Promise.resolve();
              
              controller.close();
              return;

            default:
              // Log unknown events for debugging but don't treat them as errors
              // These might be informational events that don't need processing
              logDebug("Unhandled event", { eventType: event.type });
              break;
          }
        }

        // Stream ended without completion event - send final content if available
        if (lastMessage && !messageSaved) {
          logInfo("Stream ended without completion event - sending final content");
          await saveMessage(messageId, lastMessage, reasoningContent, chatThread, toolCallHistory);
          
          const finalResponse: AzureChatCompletion = {
            type: "finalContent",
            response: lastMessage,
          };
          logInfo("Sending finalContent event (fallback)", {
            messageLength: lastMessage.length,
            responseType: finalResponse.type
          });
          streamResponse(finalResponse.type, JSON.stringify(finalResponse));
          
          // Ensure the stream is flushed before closing by yielding to the event loop
          await Promise.resolve();
          
          // Add a small delay to ensure the frontend has time to process the finalContent event
          logDebug("Waiting for frontend to process finalContent event (fallback)");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        controller.close();
      } catch (error) {
        logError("Stream processing error", { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        if (lastMessage && !messageSaved) {
          await saveMessage(messageId, lastMessage, reasoningContent, chatThread, toolCallHistory);
        }

        const errorResponse: AzureChatCompletion = {
          type: "error",
          response: error instanceof Error ? error.message : "Stream processing error",
        };
        streamResponse(errorResponse.type, JSON.stringify(errorResponse));
        
        // Ensure the stream is flushed before closing by yielding to the event loop
        await Promise.resolve();
        
        controller.close();
      }
    },
  });

  return readableStream;
};
