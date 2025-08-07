"use client";
import { uniqueId } from "@/features/common/util";
import { showError } from "@/features/globals/global-message-store";
import { AI_NAME, NEW_CHAT_NAME } from "@/features/theme/theme-config";
import {
  ParsedEvent,
  ReconnectInterval,
  createParser,
} from "eventsource-parser";
import { FormEvent } from "react";
import { proxy, useSnapshot } from "valtio";
import { RevalidateCache } from "../common/navigation-helpers";
import { InputImageStore } from "../ui/chat/chat-input-area/input-image-store";
import { textToSpeechStore } from "./chat-input/speech/use-text-to-speech";
import { ResetInputRows } from "./chat-input/use-chat-input-dynamic-height";
import { logDebug, logInfo, logWarn, logError } from "../common/services/logger";
import {
  AddExtensionToChatThread,
  RemoveExtensionFromChatThread,
  UpdateChatTitle,
  UpdateChatThreadSelectedModel,
} from "./chat-services/chat-thread-service";
import {
  AzureChatCompletion,
  ChatMessageModel,
  ChatThreadModel,
  ChatModel,
  ReasoningEffort,
  getDefaultModel as getDefaultModelFromAPI,
} from "./chat-services/models";
let abortController: AbortController = new AbortController();

type chatStatus = "idle" | "loading" | "file upload";

class ChatState {
  public messages: Array<ChatMessageModel> = [];
  public loading: chatStatus = "idle";
  public input: string = "";
  public lastMessage: string = "";
  public autoScroll: boolean = false;
  public userName: string = "";
  public chatThreadId: string = "";
  public selectedModel: ChatModel = "gpt-5"; // Will be updated when available models are fetched
  public reasoningEffort: ReasoningEffort = "medium";

  private chatThread: ChatThreadModel | undefined;
  private tempReasoningContent: string = "";
  private currentAssistantMessageId: string = "";
  public toolCallHistory: Record<string, Array<{ name: string; arguments: string; result?: string; timestamp: Date }>> = {};
  public toolCallInProgress: Record<string, string | null> = {};
  public currentToolCall: { name: string; arguments: string } | null = null;

  private addToMessages(message: ChatMessageModel) {
    const currentMessageIndex = this.messages.findIndex((el) => el.id === message.id);
    if (currentMessageIndex !== -1) {
      // Update existing message by replacing the entire object to ensure Valtio reactivity
      const currentMessage = this.messages[currentMessageIndex];
      this.messages[currentMessageIndex] = {
        ...currentMessage,
        content: message.content,
        ...(message.reasoningContent !== undefined && { reasoningContent: message.reasoningContent })
      };
    } else {
      this.messages.push(message);
    }
  }

  private removeMessage(id: string) {
    const index = this.messages.findIndex((el) => el.id === id);
    if (index > -1) {
      this.messages.splice(index, 1);
    }
  }

  public updateLoading(value: chatStatus) {
    this.loading = value;
  }

  public initChatSession({
    userName,
    messages,
    chatThread,
  }: {
    chatThread: ChatThreadModel;
    userName: string;
    messages: Array<ChatMessageModel>;
  }) {
    this.chatThread = chatThread;
    this.chatThreadId = chatThread.id;
    this.messages = messages;
    this.userName = userName;
    this.selectedModel = chatThread.selectedModel || "gpt-5";
    this.tempReasoningContent = "";
    this.currentAssistantMessageId = "";
    this.toolCallHistory = {};
    this.toolCallInProgress = {};
  }

  public async updateSelectedModel(model: ChatModel) {
    this.selectedModel = model;
    
    // Persist model selection to thread
    if (this.chatThreadId) {
      try {
        const response = await UpdateChatThreadSelectedModel(this.chatThreadId, model);
        if (response.status !== "OK") {
          showError("Failed to save model selection");
        }
      } catch (error) {
        showError("Failed to save model selection: " + error);
      }
    }
  }

  public getSelectedModel(): ChatModel {
    return this.selectedModel;
  }

  public updateReasoningEffort(effort: ReasoningEffort) {
    this.reasoningEffort = effort;
  }

  public getReasoningEffort(): ReasoningEffort {
    return this.reasoningEffort;
  }

  public async AddExtensionToChatThread(extensionId: string) {
    this.loading = "loading";

    const response = await AddExtensionToChatThread({
      extensionId: extensionId,
      chatThreadId: this.chatThreadId,
    });
    RevalidateCache({
      page: "chat",
      type: "layout",
    });

    if (response.status !== "OK") {
      showError(response.errors[0].message);
    }

    this.loading = "idle";
  }

  public async RemoveExtensionFromChatThread(extensionId: string) {
    this.loading = "loading";

    const response = await RemoveExtensionFromChatThread({
      extensionId: extensionId,
      chatThreadId: this.chatThreadId,
    });

    RevalidateCache({
      page: "chat",
    });

    if (response.status !== "OK") {
      showError(response.errors[0].message);
    }

    this.loading = "idle";
  }

  public updateInput(value: string) {
    this.input = value;
  }

  public stopGeneratingMessages() {
    abortController.abort();
  }

  public updateAutoScroll(value: boolean) {
    this.autoScroll = value;
  }

  private reset() {
    this.input = "";
    ResetInputRows();
    InputImageStore.Reset();
  }

  private async chat(formData: FormData) {
    this.updateAutoScroll(true);
    this.loading = "loading";
    this.currentAssistantMessageId = "";
    this.tempReasoningContent = "";
    this.toolCallHistory = {};
    this.toolCallInProgress = {};

    const multimodalImage = formData.get("image-base64") as unknown as string;

    const newUserMessage: ChatMessageModel = {
      id: uniqueId(),
      role: "user",
      content: this.input,
      name: this.userName,
      multiModalImage: multimodalImage,
      createdAt: new Date(),
      isDeleted: false,
      threadId: this.chatThreadId,
      type: "CHAT_MESSAGE",
      userId: "",
    };

    this.messages.push(newUserMessage);
    this.reset();

    const controller = new AbortController();
    abortController = controller;

    try {
      if (this.chatThreadId === "" || this.chatThreadId === undefined) {
        showError("Chat thread ID is empty");
        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (response.body) {
        const parser = this.createStreamParser(newUserMessage);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;

                  const chunkValue = decoder.decode(value);
        logDebug("Chat Store: Processing chunk", { 
          chunkLength: chunkValue.length,
          chunkPreview: chunkValue.substring(0, 200) + "...",
          isDone: doneReading
        });
        parser.feed(chunkValue);
        }
        logDebug("Chat Store: Stream ended", {
          timestamp: new Date().toISOString(),
          lastMessageLength: this.lastMessage?.length || 0,
          currentAssistantMessageId: this.currentAssistantMessageId,
          messagesCount: this.messages.length
        });
        
        // If we have a last message but no finalContent event was received, 
        // treat this as completion
        if (this.lastMessage && this.currentAssistantMessageId && this.loading === "loading") {
          logInfo("Chat Store: Stream ended without finalContent event, treating as completion");
          
          // Find the existing assistant message and ensure it has the final content
          const existingMessageIndex = this.messages.findIndex(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
          if (existingMessageIndex !== -1) {
            // Clean up any remaining tool call progress indicators
            const existingMessage = this.messages[existingMessageIndex];
            const finalContent = this.lastMessage.replace(/🔧 \*\*Tool Call\*\*: [^\n]*\n\n\*\*Arguments\*\*:\n\`\`\`json\n[\s\S]*?\n\`\`\`\n\n⏳ Executing\.\.\./g, "").replace(/✅ \*\*Completed\*\*/g, "");
            this.messages[existingMessageIndex] = {
              ...existingMessage,
              content: finalContent
            };
          }
          
          this.loading = "idle";
          this.completed(this.lastMessage);
          this.updateTitle();
          this.currentAssistantMessageId = "";
        } else {
          this.loading = "idle";
        }
      }
    } catch (error) {
      showError("" + error);
      this.loading = "idle";
    }
  }

  private async updateTitle() {
    if (this.chatThread && this.chatThread.name === NEW_CHAT_NAME) {
      // Fire-and-forget: update title asynchronously without blocking the UI
      setTimeout(async () => {
        try {
          await UpdateChatTitle(this.chatThreadId, this.messages[0].content);
          RevalidateCache({
            page: "chat",
            type: "layout",
          });
        } catch (error) {
          logError("Failed to update chat title", { error: error instanceof Error ? error.message : String(error) });
          // Don't show error to user since this is non-critical
        }
      }, 0);
    }
  }

  private completed(message: string) {
    textToSpeechStore.speak(message);
  }

  public async submitChat(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (this.input === "" || this.loading !== "idle") {
      return;
    }

    // get form data from e
    const formData = new FormData(e.currentTarget);

    const body = JSON.stringify({
      id: this.chatThreadId,
      message: this.input,
      selectedModel: this.selectedModel,
      reasoningEffort: this.reasoningEffort,
    });
    formData.append("content", body);

    this.chat(formData);
  }

  private createStreamParser(newUserMessage: ChatMessageModel) {
    return createParser((event: ParsedEvent | ReconnectInterval) => {
      logDebug("Chat Store: Parser received event", {
        eventType: event.type,
        eventName: event.type === "event" ? event.event : undefined,
        dataLength: event.type === "event" ? event.data?.length || 0 : 0
      });
      
      if (event.type === "event") {
        logDebug("Chat Store: Received event", { 
          dataLength: event.data?.length || 0,
          eventType: event.type,
          eventName: event.event,
          eventData: event.data?.substring(0, 200) + "..." // Log first 200 chars of data
        });
        try {
          const responseType = JSON.parse(event.data) as AzureChatCompletion;
          
          logDebug("Chat Store: Parsed response", { 
            type: responseType.type,
            hasContent: !!responseType.response,
            responseType: typeof responseType.type,
            responseKeys: Object.keys(responseType)
          });

          switch (responseType.type) {

            case "content":
              const contentChunk = responseType.response.choices?.[0]?.message?.content || "";
              
              logInfo("Chat Store: Received content event", {
                contentLength: contentChunk.length,
                messageId: this.currentAssistantMessageId,
                tempReasoningContentLength: this.tempReasoningContent?.length || 0,
                responseMessageId: responseType.response.id
              });
              
              // Use consistent message ID for all chunks of the same response
              if (!this.currentAssistantMessageId) {
                this.currentAssistantMessageId = responseType.response.id || uniqueId();
                logDebug("Chat Store: Created new assistant message ID", {
                  messageId: this.currentAssistantMessageId
                });
              }
              
              // Find existing assistant message or create new one
              const existingMessageIndex = this.messages.findIndex(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
              
              if (existingMessageIndex !== -1) {
                // Accumulate content chunks by replacing the entire message object
                const existingMessage = this.messages[existingMessageIndex];
                // No need to clean up tool call indicators since they're shown in loading overlay
                const updatedContent = existingMessage.content + contentChunk;
                this.messages[existingMessageIndex] = {
                  ...existingMessage,
                  content: updatedContent
                };
                this.lastMessage = updatedContent;
              } else {
                // Create new message for first chunk
                const mappedContent: ChatMessageModel = {
                  id: this.currentAssistantMessageId,
                  content: contentChunk,
                  name: AI_NAME,
                  role: "assistant",
                  createdAt: new Date(),
                  isDeleted: false,
                  threadId: this.chatThreadId,
                  type: "CHAT_MESSAGE",
                  userId: "",
                  multiModalImage: "",
                  reasoningContent: this.tempReasoningContent || undefined,
                };

                this.addToMessages(mappedContent);
                this.lastMessage = mappedContent.content;
                
                // Clear temporary reasoning content since we've created the message
                this.tempReasoningContent = "";
              }
              break;
            case "abort":
              this.removeMessage(newUserMessage.id);
              this.loading = "idle";
              break;
            case "error":
              showError(responseType.response);
              this.loading = "idle";
              break;
            case "reasoning":
              logInfo("Chat Store: Received reasoning event", { 
                contentLength: responseType.response?.length || 0,
                messageId: this.currentAssistantMessageId,
                tempReasoningContentLength: this.tempReasoningContent?.length || 0
              });
              
              // Ensure we have a consistent message ID for reasoning content
              if (!this.currentAssistantMessageId) {
                this.currentAssistantMessageId = uniqueId();
              }
              
              // Try to find existing assistant message
              const targetMessageIndex = this.messages.findIndex(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
              
              if (targetMessageIndex !== -1) {
                logDebug("Chat Store: Updating existing assistant message with reasoning");
                // Update the message in a way that triggers Valtio reactivity
                const targetMessage = this.messages[targetMessageIndex];
                const updatedReasoningContent = (targetMessage.reasoningContent || "") + responseType.response;
                
                // Create a new message object to ensure Valtio detects the change
                this.messages[targetMessageIndex] = {
                  ...targetMessage,
                  reasoningContent: updatedReasoningContent
                };
              } else {
                logDebug("Chat Store: Creating assistant message for reasoning display");
                // Create an assistant message immediately to show reasoning in real-time
                const reasoningMessage: ChatMessageModel = {
                  id: this.currentAssistantMessageId,
                  content: "", // Empty content initially
                  name: AI_NAME,
                  role: "assistant",
                  createdAt: new Date(),
                  isDeleted: false,
                  threadId: this.chatThreadId,
                  type: "CHAT_MESSAGE",
                  userId: "",
                  multiModalImage: "",
                  reasoningContent: (this.tempReasoningContent || "") + responseType.response,
                };

                this.addToMessages(reasoningMessage);
                
                // Clear temp reasoning content since we've created the message
                this.tempReasoningContent = "";
              }
              break;
            case "functionCall":
              logInfo("Chat Store: Received function call event", {
                functionName: (responseType as any).response?.name,
                arguments: (responseType as any).response?.arguments,
                messageId: this.currentAssistantMessageId,
                responseType: responseType.type,
                hasResponse: !!(responseType as any).response
              });
              
              // Ensure we have a consistent message ID
              if (!this.currentAssistantMessageId) {
                this.currentAssistantMessageId = uniqueId();
              }
              
              // Add tool call to history (for wrench icon)
              this.addToolCall(
                this.currentAssistantMessageId,
                (responseType as any).response.name,
                (responseType as any).response.arguments
              );
              
              // Mark tool call as in progress
              this.toolCallInProgress[this.currentAssistantMessageId] = (responseType as any).response.name;
              
              // Set current tool call for loading overlay
              this.currentToolCall = {
                name: (responseType as any).response.name,
                arguments: (responseType as any).response.arguments
              };
              
              logInfo("Chat Store: Set current tool call", {
                name: this.currentToolCall.name,
                arguments: this.currentToolCall.arguments
              });
              break;
            case "functionCallResult":
              logInfo("Chat Store: Received function call result", {
                resultLength: responseType.response?.length || 0,
                messageId: this.currentAssistantMessageId,
                responseType: responseType.type,
                hasResponse: !!responseType.response
              });
              
              // Complete the tool call
              this.completeToolCall(
                this.currentAssistantMessageId,
                responseType.response
              );
              
              // Clear in-progress indicator
              this.toolCallInProgress[this.currentAssistantMessageId] = null;
              
              // Clear current tool call for loading overlay
              this.currentToolCall = null;
              
              logInfo("Chat Store: Cleared current tool call");
              break;
            case "finalContent":
              // The finalContent event signals that streaming is complete
              logInfo("Chat Store: Processing finalContent event", {
                lastMessageLength: this.lastMessage?.length || 0,
                currentAssistantMessageId: this.currentAssistantMessageId,
                messagesCount: this.messages.length,
                responseContent: responseType.response,
                hasLastMessage: !!this.lastMessage,
                hasCurrentAssistantMessageId: !!this.currentAssistantMessageId,
                timestamp: new Date().toISOString()
              });
              
              // Ensure the final message is properly displayed in the UI
              if (this.lastMessage && this.currentAssistantMessageId) {
                // Find the existing assistant message and ensure it has the final content
                const existingMessageIndex = this.messages.findIndex(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
                
                logDebug("Chat Store: Looking for existing assistant message", {
                  messageId: this.currentAssistantMessageId,
                  existingMessageIndex,
                  totalMessages: this.messages.length
                });
                
                if (existingMessageIndex !== -1) {
                  // Update the message with the final content to ensure UI reflects the complete response
                  const existingMessage = this.messages[existingMessageIndex];
                  // Clean up any remaining tool call progress indicators
                  const finalContent = this.lastMessage.replace(/🔧 \*\*Tool Call\*\*: [^\n]*\n\n\*\*Arguments\*\*:\n\`\`\`json\n[\s\S]*?\n\`\`\`\n\n⏳ Executing\.\.\./g, "").replace(/✅ \*\*Completed\*\*/g, "");
                  this.messages[existingMessageIndex] = {
                    ...existingMessage,
                    content: finalContent
                  };
                  logDebug("Chat Store: Updated final message content", {
                    messageId: this.currentAssistantMessageId,
                    contentLength: finalContent.length,
                    toolCallCount: this.toolCallHistory[this.currentAssistantMessageId]?.length || 0
                  });
                } else {
                  logWarn("Chat Store: No existing assistant message found for final content", {
                    messageId: this.currentAssistantMessageId,
                    availableMessageIds: this.messages.map(m => ({ id: m.id, role: m.role }))
                  });
                }
              } else {
                logWarn("Chat Store: Missing lastMessage or currentAssistantMessageId", {
                  hasLastMessage: !!this.lastMessage,
                  hasCurrentAssistantMessageId: !!this.currentAssistantMessageId
                });
              }
              
              // Set loading to idle and complete the conversation
              logInfo("Chat Store: Setting loading to idle and completing conversation");
              this.loading = "idle";
              this.completed(this.lastMessage);
              
              // Update title asynchronously (non-blocking)
              this.updateTitle();
              
              // Reset the current assistant message ID for the next conversation
              // Do this last to avoid any race conditions
              logInfo("Chat Store: Resetting currentAssistantMessageId for next conversation");
              this.currentAssistantMessageId = "";
              this.currentToolCall = null;
              break;
            default:
              // Handle informational events that don't require UI updates
              const eventType = (responseType as any).type;
              if (eventType === "response.in_progress" ||
                  eventType === "response.reasoning_summary_part.added" ||
                  eventType === "response.reasoning_summary_text.done" ||
                  eventType === "response.reasoning_summary_part.done" ||
                  eventType === "response.content_part.added" ||
                  eventType === "response.output_text.done" ||
                  eventType === "response.content_part.done") {
                logDebug("Chat Store: Received informational event", {
                  eventType: eventType,
                  hasResponse: !!(responseType as any).response
                });
                // These are informational events that don't require UI updates
                // They're handled by the backend stream processor
                break;
              }
              
              logWarn("Chat Store: Unhandled response type", {
                type: eventType,
                hasResponse: !!(responseType as any).response,
                responseData: (responseType as any).response
              });
              break;
          }
        } catch (error) {
          logError("Chat Store: Error parsing event data", { 
            error: error instanceof Error ? error.message : String(error),
            eventDataLength: event.data?.length || 0 
          });
          showError("Error parsing response data");
        }
      }
    });
  }

  // --- Tool call tracking methods ---
  public addToolCall(messageId: string, name: string, args: string) {
    if (!this.toolCallHistory[messageId]) this.toolCallHistory[messageId] = [];
    this.toolCallHistory[messageId].push({ name, arguments: args, timestamp: new Date() });
    this.toolCallInProgress[messageId] = name;
  }
  public completeToolCall(messageId: string, result: string) {
    const calls = this.toolCallHistory[messageId];
    if (calls && calls.length > 0) calls[calls.length - 1].result = result;
    this.toolCallInProgress[messageId] = null;
  }
  public getToolCallHistoryForMessage(messageId: string) {
    return this.toolCallHistory[messageId] || [];
  }
  public isToolCallInProgress(messageId: string) {
    return !!this.toolCallInProgress[messageId];
  }
}

export const chatStore = proxy(new ChatState());

export const useChat = () => {
  return useSnapshot(chatStore, { sync: true });
};

// Debug hook to access tool call history
export const useToolCallHistory = (messageId: string) => {
  return chatStore.getToolCallHistoryForMessage(messageId);
};

// Hook to access current tool call for loading overlay
export const useCurrentToolCall = () => {
  const snapshot = useSnapshot(chatStore, { sync: true });
  return snapshot.currentToolCall;
};
