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
    const currentMessage = this.messages.find((el) => el.id === message.id);
    if (currentMessage) {
      // Update existing message properties
      currentMessage.content = message.content;
      if (message.reasoningContent !== undefined) {
        currentMessage.reasoningContent = message.reasoningContent;
      }
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

    // Reset the current assistant message ID for new conversation
    this.currentAssistantMessageId = "";

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
      await UpdateChatTitle(this.chatThreadId, this.messages[0].content);
      RevalidateCache({
        page: "chat",
        type: "layout",
      });
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
        console.log("🔍 Chat Store: Received event data:", event.data);
        try {
          const responseType = JSON.parse(event.data) as AzureChatCompletion;
          console.log("🔍 Chat Store: Parsed response type:", responseType.type, responseType);
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
              
              // Use consistent message ID for all chunks of the same response
              if (!this.currentAssistantMessageId) {
                this.currentAssistantMessageId = responseType.response.id || uniqueId();
              }
              
              // Find existing assistant message or create new one
              let existingMessage = this.messages.find(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
              
              if (existingMessage) {
                // Accumulate content chunks
                existingMessage.content += contentChunk;
                this.lastMessage = existingMessage.content;
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
                
                // Don't clear temporary reasoning content here - it might still be accumulating
                // It will be cleared in the finalContent event
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
              console.log("🧠 Chat Store: Received reasoning event", responseType.response.substring(0, 100) + "...");
              
              // Ensure we have a consistent message ID for reasoning content
              if (!this.currentAssistantMessageId) {
                this.currentAssistantMessageId = uniqueId();
              }
              
              // Try to find existing assistant message
              let targetMessage = this.messages.find(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
              
              if (targetMessage) {
                console.log("🧠 Chat Store: Updating existing assistant message with reasoning");
                // Accumulate reasoning content instead of overwriting
                targetMessage.reasoningContent = (targetMessage.reasoningContent || "") + responseType.response;
              } else {
                console.log("🧠 Chat Store: Storing reasoning content temporarily");
                // Accumulate reasoning content temporarily for the next assistant message
                this.tempReasoningContent = (this.tempReasoningContent || "") + responseType.response;
              }
              break;
            case "finalContent":
              // The finalContent event signals that streaming is complete
              console.log("🎯 Chat Store: Processing finalContent event");
              
              // Ensure any remaining temporary reasoning content is applied
              if (this.currentAssistantMessageId && this.tempReasoningContent) {
                const finalMessage = this.messages.find(m => m.id === this.currentAssistantMessageId && m.role === "assistant");
                if (finalMessage) {
                  console.log("🧠 Chat Store: Applying remaining temp reasoning content to final message");
                  finalMessage.reasoningContent = (finalMessage.reasoningContent || "") + this.tempReasoningContent;
                }
              }
              
              // Clear temporary state only after ensuring content is preserved
              this.tempReasoningContent = "";
              
              // Set loading to idle and complete the conversation
              this.loading = "idle";
              this.completed(this.lastMessage);
              this.updateTitle();
              
              // Reset the current assistant message ID for the next conversation
              // Do this last to avoid any race conditions
              this.currentAssistantMessageId = "";
              break;
            default:
              break;
          }
        } catch (error) {
          console.error("🔴 Chat Store: Error parsing event data:", error, event.data);
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
