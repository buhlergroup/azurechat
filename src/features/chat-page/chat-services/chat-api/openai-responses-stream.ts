import { AI_NAME } from "@/features/theme/theme-config";
import { uniqueId } from "@/features/common/util";
import { CreateChatMessage } from "../chat-message-service";
import {
  AzureChatCompletion,
  AzureChatCompletionAbort,
  AzureChatCompletionReasoning,
  ChatThreadModel,
} from "../models";

export const OpenAIResponsesStream = (props: {
  stream: AsyncIterable<any>;
  chatThread: ChatThreadModel;
}) => {
  const encoder = new TextEncoder();

  const { stream, chatThread } = props;

  const readableStream = new ReadableStream({
    async start(controller) {
      const streamResponse = (event: string, value: string) => {
        controller.enqueue(encoder.encode(`event: ${event} \n`));
        controller.enqueue(encoder.encode(`data: ${value} \n\n`));
      };

      let lastMessage = "";
      let reasoningContent = "";
      let reasoningSummaries: Record<number, string> = {}; // Track multiple summary parts
      let currentResponse: any = null;
      const messageId = uniqueId(); // Generate consistent message ID for the entire response

      try {
        for await (const event of stream) {
          console.log("🔍 Received SSE event:", {
            type: event.type,
            hasData: !!event.data,
            keys: Object.keys(event),
            event: event
          });

          switch (event.type) {
            case "response.queued":
              // console.log("📋 Response queued:", event);
              break;

            case "response.output_item.added":
              // console.log("➕ Output item added:", event);
              if (event.item) {
                currentResponse = event.item;
              }
              break;

            case "response.output_text.delta":
              // console.log("📝 Output text delta:", event);
              if (event.delta) {
                lastMessage += event.delta;

                const response: AzureChatCompletion = {
                  type: "content",
                  response: {
                    id: messageId,
                    choices: [{
                      message: {
                        content: event.delta, // Send only the delta chunk, not accumulated content
                        role: "assistant"
                      }
                    }]
                  },
                };
                streamResponse(response.type, JSON.stringify(response));
              }
              break;

            case "response.text.delta":
              // console.log("📝 Text delta:", event);
              if (event.delta) {
                lastMessage += event.delta;

                const response: AzureChatCompletion = {
                  type: "content",
                  response: {
                    id: messageId,
                    choices: [{
                      message: {
                        content: event.delta, // Send only the delta chunk, not accumulated content
                        role: "assistant"
                      }
                    }]
                  },
                };
                streamResponse(response.type, JSON.stringify(response));
              }
              break;

            case "response.text.done":
              // console.log("✅ Text done:", event);
              if (event.text) {
                lastMessage = event.text;
                // Don't send done events as they would duplicate content
                // The final content will be sent in response.done
              }
              break;

            case "response.reasoning_summary_text.delta":
              // console.log("🧠 Reasoning summary delta:", event);
              if (event.delta) {
                const summaryIndex = event.summary_index || 0;
                reasoningSummaries[summaryIndex] = (reasoningSummaries[summaryIndex] || '') + event.delta;
                
                // Send delta chunks for reasoning content
                const reasoningResponse: AzureChatCompletionReasoning = {
                  type: "reasoning",
                  response: event.delta,
                };
                streamResponse(reasoningResponse.type, JSON.stringify(reasoningResponse));
                
                // Update combined reasoning for final save
                reasoningContent = Object.values(reasoningSummaries).join('\n\n');
              }
              break;

            case "response.reasoning_summary_text.done":
              // console.log("🧠 Reasoning summary done:", event);
              if (event.text) {
                const summaryIndex = event.summary_index || 0;
                reasoningSummaries[summaryIndex] = event.text;
                
                // Update combined reasoning for final save
                reasoningContent = Object.values(reasoningSummaries).join('\n\n');
              }
              break;

            case "response.output_item.done":
              // console.log("🏁 Output item done:", event);
              if (event.item && event.item.content) {
                // Handle different content formats
                if (Array.isArray(event.item.content)) {
                  // Extract text from array of content objects
                  lastMessage = event.item.content
                    .map((item: any) => item.text || item.content || '')
                    .join('');
                } else if (typeof event.item.content === 'string') {
                  lastMessage = event.item.content;
                } else if (event.item.content.text) {
                  lastMessage = event.item.content.text;
                } else {
                  lastMessage = String(event.item.content);
                }
                console.log("🏁 Output item done - extracted text:", {
                  originalContent: event.item.content,
                  extractedText: lastMessage,
                  textLength: lastMessage.length
                });
              }
              break;

            // Function calling events
            case "response.function_call.delta":
              // console.log("🔧 Function call delta:", event);
              break;

            case "response.function_call.done":
              // console.log("🔧 Function call done:", event);
              if (event.function_call) {
                const functionResponse: AzureChatCompletion = {
                  type: "functionCall",
                  response: event.function_call,
                };
                streamResponse(functionResponse.type, JSON.stringify(functionResponse));
              }
              break;

            // Image generation events
            case "response.image_generation_call.delta":
              // console.log("🎨 Image generation delta:", event);
              break;

            case "response.image_generation_call.partial_image":
              // console.log("🖼️ Partial image:", event);
              if (event.partial_image_b64) {
                const imageResponse: AzureChatCompletion = {
                  type: "content",
                  response: {
                    type: "partial_image",
                    data: event.partial_image_b64,
                    index: event.partial_image_index
                  },
                };
                streamResponse(imageResponse.type, JSON.stringify(imageResponse));
              }
              break;

            case "response.image_generation_call.done":
              // console.log("🎨 Image generation done:", event);
              if (event.result) {
                const imageResponse: AzureChatCompletion = {
                  type: "content",
                  response: {
                    type: "image_generation",
                    data: event.result
                  },
                };
                streamResponse(imageResponse.type, JSON.stringify(imageResponse));
              }
              break;

            // MCP events
            case "response.mcp_approval_request":
              // console.log("🔐 MCP approval request:", event);
              const mcpApprovalResponse: AzureChatCompletion = {
                type: "content",
                response: {
                  type: "mcp_approval_request",
                  data: event
                },
              };
              streamResponse(mcpApprovalResponse.type, JSON.stringify(mcpApprovalResponse));
              break;

            case "response.mcp_call.delta":
              // console.log("🌐 MCP call delta:", event);
              break;

            case "response.mcp_call.done":
              // console.log("🌐 MCP call done:", event);
              break;

            // Background task events
            case "response.queued":
              // console.log("⏳ Response queued:", event);
              const queuedResponse: AzureChatCompletion = {
                type: "content",
                response: {
                  type: "queued",
                  status: "queued"
                },
              };
              streamResponse(queuedResponse.type, JSON.stringify(queuedResponse));
              break;

            case "response.in_progress":
              // console.log("⚡ Response in progress:", event);
              const progressResponse: AzureChatCompletion = {
                type: "content",
                response: {
                  type: "in_progress",
                  status: "in_progress"
                },
              };
              streamResponse(progressResponse.type, JSON.stringify(progressResponse));
              break;

            case "response.cancelled":
              // console.log("❌ Response cancelled:", event);
              const cancelledResponse: AzureChatCompletion = {
                type: "abort",
                response: "Response was cancelled",
              };
              streamResponse(cancelledResponse.type, JSON.stringify(cancelledResponse));
              controller.close();
              break;

            case "response.done":
              // console.log("🎯 Response done:", event);
              
              // Extract final content from the response if available
              if (event.response && event.response.output) {
                // Handle different output formats
                if (Array.isArray(event.response.output)) {
                  lastMessage = event.response.output
                    .map((item: any) => item.text || item.content || '')
                    .join('');
                } else if (event.response.output.text) {
                  lastMessage = event.response.output.text;
                } else if (typeof event.response.output === 'string') {
                  lastMessage = event.response.output;
                }
              }
              
              // Prioritize event-based reasoning summaries over legacy field-based approach
              let finalReasoningContent = reasoningContent;
              
              // If we have event-based reasoning summaries, use those
              if (Object.keys(reasoningSummaries).length > 0) {
                finalReasoningContent = Object.values(reasoningSummaries).join('\n\n');
              }

              // Save the final message with the consistent messageId
              console.log("💾 Saving final assistant message to DB:", {
                messageId,
                contentLength: lastMessage.length,
                hasReasoningContent: !!finalReasoningContent,
                reasoningContentLength: finalReasoningContent?.length || 0,
                lastMessage: lastMessage.substring(0, 100) + "..."
              });
              
              await CreateChatMessage({
                name: AI_NAME,
                content: lastMessage,
                role: "assistant",
                chatThreadId: chatThread.id,
                reasoningContent: finalReasoningContent || undefined,
              });

              const finalResponse: AzureChatCompletion = {
                type: "finalContent",
                response: lastMessage,
              };
              streamResponse(finalResponse.type, JSON.stringify(finalResponse));
              controller.close();
              break;

            case "error":
              console.log("🔴 Stream error:", event);
              const errorResponse: AzureChatCompletion = {
                type: "error",
                response: event.error?.message || "Unknown error occurred",
              };

              // Save the last message even though it's not complete
              if (lastMessage) {
                await CreateChatMessage({
                  name: AI_NAME,
                  content: lastMessage,
                  role: "assistant",
                  chatThreadId: chatThread.id,
                });
              }

              streamResponse(errorResponse.type, JSON.stringify(errorResponse));
              controller.close();
              break;

            default:
              // Handle unknown event types, including potential finalContent from other sources
              console.log("❓ Unknown event type:", event.type, event);
              
              // Check if this is a finalContent event from another source
              if (event.type === "finalContent") {
                console.log("🎯 Received finalContent from unknown source:", event);
                // Don't process this here - let the chat store handle it
              }
              break;
          }
        }
        
        // If we reach here, the stream ended without a proper response.done event
        // This is a fallback to ensure the frontend knows the response is complete
        if (lastMessage && controller.desiredSize !== null) {
          console.log("🔄 Stream ended without response.done, sending finalContent");
          
          // Save the final message if not already saved
          await CreateChatMessage({
            name: AI_NAME,
            content: lastMessage,
            role: "assistant",
            chatThreadId: chatThread.id,
            reasoningContent: reasoningContent || undefined,
          });

          const finalResponse: AzureChatCompletion = {
            type: "finalContent",
            response: lastMessage,
          };
          streamResponse(finalResponse.type, JSON.stringify(finalResponse));
          controller.close();
        }
      } catch (error) {
        console.log("🔴 Stream processing error:", error);
        
        const errorResponse: AzureChatCompletion = {
          type: "error",
          response: error instanceof Error ? error.message : "Stream processing error",
        };

        // Save the last message even though it's not complete
        if (lastMessage) {
          await CreateChatMessage({
            name: AI_NAME,
            content: lastMessage,
            role: "assistant",
            chatThreadId: chatThread.id,
            reasoningContent: reasoningContent || undefined,
          });
        }

        streamResponse(errorResponse.type, JSON.stringify(errorResponse));
        controller.close();
      }
    },
  });

  return readableStream;
};
