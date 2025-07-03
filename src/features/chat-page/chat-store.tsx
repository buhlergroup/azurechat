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
  public selectedModel: ChatModel = "gpt-4.1"; // Will be updated when available models are fetched
  public reasoningEffort: ReasoningEffort = "medium";

  private chatThread: ChatThreadModel | undefined;
  private tempReasoningContent: string = "";
  private currentAssistantMessageId: string = "";

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
    // Initialize selected model from thread or use fallback
    this.selectedModel = chatThread.selectedModel || "gpt-4.1";
        
    // Reset temporary state to prevent reasoning content from previous threads leaking through
    this.tempReasoningContent = "";
    this.currentAssistantMessageId = "";
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

    // Reset the current assistant message ID and temp reasoning content for new conversation
    this.currentAssistantMessageId = "";
    this.tempReasoningContent = "";

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
          parser.feed(chunkValue);
        }
        this.loading = "idle";
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
          console.error("Failed to update chat title:", error);
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
      if (event.type === "event") {
        console.debug("🔍 Chat Store: Received event", { 
          dataLength: event.data?.length || 0 
        });
        try {
          const responseType = JSON.parse(event.data) as AzureChatCompletion;
          console.debug("🔍 Chat Store: Parsed response", { 
            type: responseType.type,
            hasContent: !!responseType.response 
          });
          switch (responseType.type) {
            case "functionCall":
              const mappedFunction: ChatMessageModel = {
                id: uniqueId(),
                content: responseType.response.arguments,
                name: responseType.response.name,
                role: "function",
                createdAt: new Date(),
                isDeleted: false,
                threadId: this.chatThreadId,
                type: "CHAT_MESSAGE",
                userId: "",
                multiModalImage: "",
              };
              this.addToMessages(mappedFunction);
              break;
            case "functionCallResult":
              const mappedFunctionResult: ChatMessageModel = {
                id: uniqueId(),
                content: responseType.response,
                name: "tool",
                role: "tool",
                createdAt: new Date(),
                isDeleted: false,
                threadId: this.chatThreadId,
                type: "CHAT_MESSAGE",
                userId: "",
                multiModalImage: "",
              };
              this.addToMessages(mappedFunctionResult);
              break;
            case "content":
              const contentChunk = responseType.response.choices?.[0]?.message?.content || "";
              
              console.info("📝 Chat Store: Received content event", {
                contentLength: contentChunk.length,
                messageId: this.currentAssistantMessageId,
                tempReasoningContentLength: this.tempReasoningContent?.length || 0
              });
              
              // Use consistent message ID for all chunks of the same response
              if (!this.currentAssistantMessageId) {
                this.currentAssistantMessageId = responseType.response.id || uniqueId();
              }
              
              // Find existing assistant message or create new one
              const existingMessageIndex = this.messages.findIndex(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
              
              if (existingMessageIndex !== -1) {
                // Accumulate content chunks by replacing the entire message object
                const existingMessage = this.messages[existingMessageIndex];
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
              console.info("🧠 Chat Store: Received reasoning event", { 
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
                console.debug("🧠 Chat Store: Updating existing assistant message with reasoning");
                // Update the message in a way that triggers Valtio reactivity
                const targetMessage = this.messages[targetMessageIndex];
                const updatedReasoningContent = (targetMessage.reasoningContent || "") + responseType.response;
                
                // Create a new message object to ensure Valtio detects the change
                this.messages[targetMessageIndex] = {
                  ...targetMessage,
                  reasoningContent: updatedReasoningContent
                };
              } else {
                console.debug("🧠 Chat Store: Creating assistant message for reasoning display");
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
            case "finalContent":
              // The finalContent event signals that streaming is complete
              console.info("🎯 Chat Store: Processing finalContent event");
              
              // Set loading to idle and complete the conversation
              this.loading = "idle";
              this.completed(this.lastMessage);
              
              // Update title asynchronously (non-blocking)
              this.updateTitle();
              
              // Reset the current assistant message ID for the next conversation
              // Do this last to avoid any race conditions
              this.currentAssistantMessageId = "";
              break;
            default:
              break;
          }
        } catch (error) {
          console.error("🔴 Chat Store: Error parsing event data:", { 
            error: error instanceof Error ? error.message : String(error),
            eventDataLength: event.data?.length || 0 
          });
          showError("Error parsing response data");
        }
      }
    });
  }
}

export const chatStore = proxy(new ChatState());

export const useChat = () => {
  return useSnapshot(chatStore, { sync: true });
};
