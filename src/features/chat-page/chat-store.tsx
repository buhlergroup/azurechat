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
  public selectedModel: ChatModel = "gpt-4.1";
  public reasoningEffort: ReasoningEffort = "medium";

  private chatThread: ChatThreadModel | undefined;
  private tempReasoningContent: string = "";

  private addToMessages(message: ChatMessageModel) {
    const currentMessage = this.messages.find((el) => el.id === message.id);
    if (currentMessage) {
      currentMessage.content = message.content;
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
    // Initialize selected model from thread or default to gpt-4.1
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
        const responseType = JSON.parse(event.data) as AzureChatCompletion;
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
            const mappedContent: ChatMessageModel = {
              id: responseType.response.id,
              content: responseType.response.choices[0].message.content || "",
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
            
            // Clear temporary reasoning content after using it
            if (this.tempReasoningContent) {
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
            console.log("🧠 Chat Store: Received reasoning event", responseType.response.substring(0, 100) + "...");
            // Handle reasoning content - update the last assistant message with reasoning
            // or store it temporarily if no assistant message exists yet
            const lastAssistantMessage = this.messages
              .slice()
              .reverse()
              .find(m => m.role === "assistant");
            if (lastAssistantMessage) {
              console.log("🧠 Chat Store: Updating existing assistant message with reasoning");
              lastAssistantMessage.reasoningContent = responseType.response;
            } else {
              console.log("🧠 Chat Store: Storing reasoning content temporarily");
              // Store reasoning content temporarily for the next assistant message
              this.tempReasoningContent = responseType.response;
            }
            break;
          case "finalContent":
            this.loading = "idle";
            this.completed(this.lastMessage);
            this.updateTitle();
            break;
          default:
            break;
        }
      }
    });
  }
}

export const chatStore = proxy(new ChatState());

export const useChat = () => {
  return useSnapshot(chatStore, { sync: true });
};
