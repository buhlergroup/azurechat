import { AI_NAME } from "@/features/theme/theme-config";
import { ChatCompletionStreamingRunner } from "openai/resources/chat/completions";
import { CreateChatMessage } from "../chat-message-service";
import {
  AzureChatCompletion,
  AzureChatCompletionAbort,
  AzureChatCompletionReasoning,
  ChatThreadModel,
} from "../models";

export const OpenAIStream = (props: {
  runner: ChatCompletionStreamingRunner;
  chatThread: ChatThreadModel;
}) => {
  const encoder = new TextEncoder();

  const { runner, chatThread } = props;

  const readableStream = new ReadableStream({
    async start(controller) {
      const streamResponse = (event: string, value: string) => {
        controller.enqueue(encoder.encode(`event: ${event} \n`));
        controller.enqueue(encoder.encode(`data: ${value} \n\n`));
      };

      let lastMessage = "";
      let reasoningContent = "";
      let reasoningSummaries: Record<number, string> = {}; // Track multiple summary parts

      // Debug: Log all events to see what's being received
      runner.on("chunk" as any, (chunk: any) => {
        // console.log("🔍 Received chunk:", {
        //   type: chunk.type,
        //   hasData: !!chunk.data,
        //   keys: Object.keys(chunk)
        // });
        
        // Handle reasoning summary events from the new API structure
        if (chunk.type === "response.reasoning_summary_text.delta") {
          // console.log("🧠 Reasoning summary delta:", chunk);
          if (chunk.delta) {
            const summaryIndex = chunk.summary_index || 0;
            reasoningSummaries[summaryIndex] = (reasoningSummaries[summaryIndex] || '') + chunk.delta;
            
            // Combine all summary parts for streaming
            const combinedReasoning = Object.values(reasoningSummaries).join('\n\n');
            
            if (combinedReasoning !== reasoningContent) {
              reasoningContent = combinedReasoning;
              
              const reasoningResponse: AzureChatCompletionReasoning = {
                type: "reasoning",
                response: reasoningContent,
              };
              streamResponse(reasoningResponse.type, JSON.stringify(reasoningResponse));
            }
          }
        } else if (chunk.type === "response.reasoning_summary_text.done") {
          // console.log("🧠 Reasoning summary done:", chunk);
          if (chunk.text) {
            const summaryIndex = chunk.summary_index || 0;
            reasoningSummaries[summaryIndex] = chunk.text;
            
            // Combine all summary parts
            const combinedReasoning = Object.values(reasoningSummaries).join('\n\n');
            
            if (combinedReasoning !== reasoningContent) {
              reasoningContent = combinedReasoning;
              
              const reasoningResponse: AzureChatCompletionReasoning = {
                type: "reasoning",
                response: reasoningContent,
              };
              streamResponse(reasoningResponse.type, JSON.stringify(reasoningResponse));
            }
          }
        }
      });

      // Keep the legacy event listeners for backward compatibility
      runner
        .on("response.reasoning_summary_text.delta" as any, (event: any) => {
          // console.log("🧠 Legacy reasoning summary delta:", event);
          // Handle reasoning summary delta events          
          if (event.delta) {
            const summaryIndex = event.summary_index || 0;
            reasoningSummaries[summaryIndex] = (reasoningSummaries[summaryIndex] || '') + event.delta;
            
            // Combine all summary parts for streaming
            const combinedReasoning = Object.values(reasoningSummaries).join('\n\n');
            
            if (combinedReasoning !== reasoningContent) {
              reasoningContent = combinedReasoning;
              
              const reasoningResponse: AzureChatCompletionReasoning = {
                type: "reasoning",
                response: reasoningContent,
              };
              streamResponse(reasoningResponse.type, JSON.stringify(reasoningResponse));
            }
          }
        })
        .on("response.reasoning_summary_text.done" as any, (event: any) => {
          // console.log("🧠 Legacy reasoning summary done:", event);
          // Handle reasoning summary completion events
          
          if (event.text) {
            const summaryIndex = event.summary_index || 0;
            reasoningSummaries[summaryIndex] = event.text;
            
            // Combine all summary parts
            const combinedReasoning = Object.values(reasoningSummaries).join('\n\n');
            
            if (combinedReasoning !== reasoningContent) {
              reasoningContent = combinedReasoning;
              
              const reasoningResponse: AzureChatCompletionReasoning = {
                type: "reasoning",
                response: reasoningContent,
              };
              streamResponse(reasoningResponse.type, JSON.stringify(reasoningResponse));
            }
          }
        })
        .on("content", (content) => {
          const completion = runner.currentChatCompletionSnapshot;

          if (completion) {
            const response: AzureChatCompletion = {
              type: "content",
              response: completion,
            };
            lastMessage = completion.choices[0].message.content ?? "";
            
            // Check for reasoning content in O1/O3 responses
            const message = completion.choices[0].message as any;
            const choice = completion.choices[0] as any;
            
            // Debug logging to see the structure
            // console.log("🔍 OpenAI Response Structure:", {
            //   messageKeys: Object.keys(message),
            //   choiceKeys: Object.keys(choice),
            //   hasReasoning: !!message.reasoning,
            //   hasReasoningContent: !!message.reasoning_content,
            //   hasThoughts: !!message.thoughts,
            //   choiceHasReasoning: !!choice.reasoning,
            //   completionKeys: Object.keys(completion),
            //   hasReasoningSummary: !!(completion as any).reasoning?.summary,
            //   reasoningKeys: (completion as any).reasoning ? Object.keys((completion as any).reasoning) : []
            // });
            
            // Handle different reasoning field structures
            let currentReasoningContent = null;
            
            // First check for reasoning summary from the new API structure
            if ((completion as any).reasoning?.summary) {
              currentReasoningContent = (completion as any).reasoning.summary;
            }
            // Fallback to existing reasoning content fields
            else if (message.reasoning) {
              currentReasoningContent = message.reasoning;
            } else if (message.reasoning_content) {
              currentReasoningContent = message.reasoning_content;
            } else if (message.thoughts) {
              currentReasoningContent = message.thoughts;
            } else if (choice.reasoning) {
              currentReasoningContent = choice.reasoning;
            }
            
            if (currentReasoningContent && currentReasoningContent !== reasoningContent) {
              reasoningContent = currentReasoningContent;
              const reasoningResponse: AzureChatCompletionReasoning = {
                type: "reasoning",
                response: reasoningContent,
              };
              streamResponse(reasoningResponse.type, JSON.stringify(reasoningResponse));
            }
            
            streamResponse(response.type, JSON.stringify(response));
          }
        })
        .on("functionToolCall" as any, async (functionCall: any) => {
          await CreateChatMessage({
            name: functionCall.name,
            content: functionCall.arguments,
            role: "function",
            chatThreadId: chatThread.id,
          });

          const response: AzureChatCompletion = {
            type: "functionCall",
            response: functionCall,
          };
          streamResponse(response.type, JSON.stringify(response));
        })
        .on("functionToolCallResult" as any, async (functionCallResult: any) => {
          const response: AzureChatCompletion = {
            type: "functionCallResult",
            response: functionCallResult,
          };
          await CreateChatMessage({
            name: "tool",
            content: functionCallResult,
            role: "function",
            chatThreadId: chatThread.id,
          });
          streamResponse(response.type, JSON.stringify(response));
        })
        .on("abort", (error) => {
          const response: AzureChatCompletionAbort = {
            type: "abort",
            response: "Chat aborted",
          };
          streamResponse(response.type, JSON.stringify(response));
          controller.close();
        })
        .on("error", async (error) => {
          // console.log("🔴 error", error);
          const response: AzureChatCompletion = {
            type: "error",
            response: error.message,
          };

          // if there is an error still save the last message even though it is not complete
          await CreateChatMessage({
            name: AI_NAME,
            content: lastMessage,
            role: "assistant",
            chatThreadId: props.chatThread.id,
          });

          streamResponse(response.type, JSON.stringify(response));
          controller.close();
        })
        .on("finalContent", async (content: string) => {
          // Prioritize event-based reasoning summaries over legacy field-based approach
          let finalReasoningContent = reasoningContent;
          
          // If we have event-based reasoning summaries, use those
          if (Object.keys(reasoningSummaries).length > 0) {
            finalReasoningContent = Object.values(reasoningSummaries).join('\n\n');
          }
          
          console.log("💾 Saving final assistant message to DB (legacy stream):", {
            contentLength: content.length,
            hasReasoningContent: !!finalReasoningContent,
            reasoningContentLength: finalReasoningContent?.length || 0
          });
          
          await CreateChatMessage({
            name: AI_NAME,
            content: content,
            role: "assistant",
            chatThreadId: props.chatThread.id,
            reasoningContent: finalReasoningContent || undefined,
          });

          const response: AzureChatCompletion = {
            type: "finalContent",
            response: content,
          };
          streamResponse(response.type, JSON.stringify(response));
          controller.close();
        });
    },
  });

  return readableStream;
};
