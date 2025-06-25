import { AI_NAME } from "@/features/theme/theme-config";
import { uniqueId } from "@/features/common/util";
import { CreateChatMessage, UpsertChatMessage } from "../chat-message-service";
import {
  AzureChatCompletion,
  AzureChatCompletionAbort,
  AzureChatCompletionReasoning,
  ChatThreadModel,
  ChatMessageModel,
  MESSAGE_ATTRIBUTE,
} from "../models";
import { 
  reportCompletionTokens, 
  reportPromptTokens 
} from "@/features/common/services/chat-metrics-service";
import { userHashedId } from "@/features/auth-page/helpers";

export const OpenAIResponsesStream = (props: {
  stream: AsyncIterable<any>;
  chatThread: ChatThreadModel;
}) => {
  const encoder = new TextEncoder();
  const { stream, chatThread } = props;

  // Helper function to extract text content from various response formats
  const extractTextContent = (output: any): string => {
    if (!output) return '';

    // Handle array format (most common)
    if (Array.isArray(output)) {
      return output
        .map((item: any) => {
          if (typeof item === 'string') return item;
          if (item?.content && Array.isArray(item.content)) {
            return item.content
              .map((contentItem: any) => {
                if (typeof contentItem === 'string') return contentItem;
                return contentItem?.text || contentItem?.content || '';
              })
              .join('');
          }
          return item?.text || item?.content || '';
        })
        .join('');
    }

    // Handle direct text properties
    if (output.text) return output.text;
    if (typeof output === 'string') return output;
    
    // Handle content property
    if (output.content) {
      if (Array.isArray(output.content)) {
        return output.content
          .map((item: any) => {
            if (typeof item === 'string') return item;
            return item?.text || item?.content || '';
          })
          .join('');
      }
      if (typeof output.content === 'string') return output.content;
    }

    // Fallback to common text properties
    return output.message || output.text_content || output.data || '';
  };

  // Helper function to save message
  const saveMessage = async (messageId: string, content: string, reasoningContent: string, chatThread: ChatThreadModel) => {
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
    };
    
    await UpsertChatMessage(messageToSave);
    console.log(`💾 Message saved (${content.length} chars)`);
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
    console.log(`🎯 Response ${event.type === 'response.completed' ? 'completed' : 'done'}`);
    
    // Extract final content from response if available
    if (event.response?.output) {
      const extractedContent = extractTextContent(event.response.output);
      if (extractedContent) {
        lastMessage = extractedContent;
        console.log(`📝 Final content extracted (${extractedContent.length} chars)`);
      }
    }

    // Use event-based reasoning summaries if available
    const finalReasoningContent = Object.keys(reasoningSummaries).length > 0 
      ? Object.values(reasoningSummaries).join('\n\n') 
      : reasoningContent;

    // Save message to database
    await saveMessage(messageId, lastMessage, finalReasoningContent, chatThread);

    // Report token usage
    if (event.response?.usage) {
      const { input_tokens, output_tokens, total_tokens } = event.response.usage;
      console.log(`📊 Token usage: ${input_tokens}+${output_tokens}=${total_tokens}`);
      
      await reportCompletionTokens(output_tokens, chatThread.selectedModel || "gpt-4o", {
        personaMessageTitle: chatThread.personaMessageTitle,
        threadId: chatThread.id,
        messageId: messageId,
        totalTokens: total_tokens,
        inputTokens: input_tokens
      });

      await reportPromptTokens(input_tokens, chatThread.selectedModel || "gpt-4o", "user", {
        personaMessageTitle: chatThread.personaMessageTitle,
        threadId: chatThread.id,
        messageId: messageId,
      });
    }

    // Send final response and close
    const finalResponse: AzureChatCompletion = {
      type: "finalContent",
      response: lastMessage,
    };
    streamResponse(finalResponse.type, JSON.stringify(finalResponse));
    controller.close();
  };

  const readableStream = new ReadableStream({
    async start(controller) {
      const streamResponse = (event: string, value: string) => {
        if (controller.desiredSize !== null) {
          controller.enqueue(encoder.encode(`event: ${event} \n`));
          controller.enqueue(encoder.encode(`data: ${value} \n\n`));
        }
      };

      let lastMessage = "";
      let reasoningContent = "";
      let reasoningSummaries: Record<number, string> = {};
      let messageSaved = false;
      const messageId = uniqueId();
      try {
        for await (const event of stream) {
          // Log event type and basic info
          console.log(`🔍 SSE event: ${event.type}`);

          switch (event.type) {
            case "response.queued":
            case "response.created":
            case "response.in_progress":
            case "response.content_part.added":
              // Status events - no action needed
              break;

            case "response.output_item.added":
              // Output item initialization - no action needed
              break;            case "response.output_text.delta":
            case "response.text.delta":
              // Handle text delta events
              if (event.delta) {
                const deltaContent = typeof event.delta === 'string' ? event.delta : String(event.delta);
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

            case "response.text.done":
            case "response.output_text.done":
            case "response.content_part.done":
              // Handle completion of text content
              if (event.text) {
                lastMessage = event.text;
              } else if (event.part?.text) {
                lastMessage = event.part.text;
              }
              break;            case "response.reasoning_summary_text.delta":
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

            case "response.reasoning_summary_text.done":
              if (event.text) {
                const summaryIndex = event.summary_index || 0;
                reasoningSummaries[summaryIndex] = event.text;
                reasoningContent = Object.values(reasoningSummaries).join('\n\n');
              }
              break;
            case "response.output_item.done":
              if (event.item?.content) {
                const extractedContent = extractTextContent(event.item.content);
                if (extractedContent && extractedContent.trim() !== '' && extractedContent !== '[object Object]') {
                  lastMessage = extractedContent;
                  console.log(`✅ Extracted text (${extractedContent.length} chars)`);
                }
              }
              break;            // Function calling events
            case "response.function_call.delta":
              break;

            case "response.function_call.done":
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
              break;

            case "response.image_generation_call.partial_image":
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
            case "response.mcp_call.done":
              break;

            case "response.cancelled":
              const cancelledResponse: AzureChatCompletion = {
                type: "abort",
                response: "Response was cancelled",
              };
              streamResponse(cancelledResponse.type, JSON.stringify(cancelledResponse));
              controller.close();
              break;            case "response.completed":
            case "response.done":
              await handleResponseCompletion(event, lastMessage, reasoningContent, reasoningSummaries, messageId, chatThread, controller, streamResponse);
              return;

            case "error":
              console.log("🔴 Stream error:", event.error?.message || "Unknown error");
              const errorResponse: AzureChatCompletion = {
                type: "error",
                response: event.error?.message || "Unknown error occurred",
              };

              if (lastMessage && !messageSaved) {
                await saveMessage(messageId, lastMessage, reasoningContent, chatThread);
                messageSaved = true;
              }

              streamResponse(errorResponse.type, JSON.stringify(errorResponse));
              controller.close();
              return;

            default:
              // Log unknown events for debugging
              console.log(`❓ Unknown event: ${event.type}`);
              break;
          }
        }

        // Stream ended without completion event - send final content if available
        if (lastMessage && !messageSaved) {
          console.log("🔄 Stream ended without completion event");
          await saveMessage(messageId, lastMessage, reasoningContent, chatThread);
          
          const finalResponse: AzureChatCompletion = {
            type: "finalContent",
            response: lastMessage,
          };
          streamResponse(finalResponse.type, JSON.stringify(finalResponse));
        }
        controller.close();
      } catch (error) {
        console.log("🔴 Stream processing error:", error);
        
        if (lastMessage && !messageSaved) {
          await saveMessage(messageId, lastMessage, reasoningContent, chatThread);
        }

        const errorResponse: AzureChatCompletion = {
          type: "error",
          response: error instanceof Error ? error.message : "Stream processing error",
        };
        streamResponse(errorResponse.type, JSON.stringify(errorResponse));
        controller.close();
      }
    },
  });

  return readableStream;
};
