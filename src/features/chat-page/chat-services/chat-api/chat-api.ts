"use server";
import "server-only";

import { getCurrentUser } from "@/features/auth-page/helpers";
import { CHAT_DEFAULT_SYSTEM_PROMPT } from "@/features/theme/theme-config";
import { ChatCompletionStreamingRunner } from "openai/resources/chat/completions";
import { ChatApiRAG } from "../chat-api/chat-api-rag";
import { FindAllChatDocuments } from "../chat-document-service";
import {
  CreateChatMessage,
  FindTopChatMessagesForCurrentUser,
} from "../chat-message-service";
import { EnsureChatThreadOperation } from "../chat-thread-service";
import {
  ChatThreadModel,
  SupportedFileExtensionsInputImages,
  UserPrompt,
} from "../models";
import { mapOpenAIChatMessages } from "../utils";
import { GetDefaultExtensions } from "./chat-api-default-extensions";
import { GetDynamicExtensions } from "./chat-api-dynamic-extensions";
import { ChatApiExtensions } from "./chat-api-extension";
import { ChatApiResponses } from "./chat-api-responses";
import { OpenAIStream } from "./open-ai-stream";
import { OpenAIResponsesStream } from "./openai-responses-stream";
import {
  reportCompletionTokens,
  reportUserChatMessage,
} from "../../../common/services/chat-metrics-service";
import { ChatTokenService } from "@/features/common/services/chat-token-service";
import { MODEL_CONFIGS } from "../models";
type ChatTypes = "extensions" | "chat-with-file";

export const ChatAPIEntry = async (props: UserPrompt, signal: AbortSignal) => {
  const currentChatThreadResponse = await EnsureChatThreadOperation(props.id);

  if (currentChatThreadResponse.status !== "OK") {
    return new Response("", { status: 401 });
  }

  // Get selected model from props or default to gpt-4.1
  const selectedModel = props.selectedModel || "gpt-4.1";
  const modelConfig = MODEL_CONFIGS[selectedModel];
  const reasoningEffort = props.reasoningEffort || "medium";

  if (props.multimodalImage) {
    const base64Image = props.multimodalImage;
    const matches = base64Image.match(/^data:image\/([a-zA-Z]+);base64,/);
    const fileExtension = matches ? matches[1] : null;

    if (!fileExtension)
      return new Response("Missing File Extension", { status: 400 });

    if (
      !Object.values(SupportedFileExtensionsInputImages).includes(
        fileExtension.toUpperCase() as SupportedFileExtensionsInputImages
      )
    )
      return new Response("Filetype is not supported", { status: 400 });
  }

  const currentChatThread = currentChatThreadResponse.response;

  // promise all to get user, history and docs
  const [user, history, docs, extension] = await Promise.all([
    getCurrentUser(),
    _getHistory(currentChatThread),
    _getDocuments(currentChatThread),
    _getExtensions({
      chatThread: currentChatThread,
      userMessage: props.message,
      signal,
    }),
  ]);
  // Starting values for system and user prompt
  // Note that the system message will also get prepended with the extension execution steps. Please see ChatApiExtensions method.
  currentChatThread.personaMessage = `${CHAT_DEFAULT_SYSTEM_PROMPT} \n\n Todays Date: ${new Date().toLocaleString()}\n\n ${currentChatThread.personaMessage}`;
  let chatType: ChatTypes = "extensions";

  if (docs.length > 0 || currentChatThread.personaDocumentIds.length > 0) {
    chatType = "chat-with-file";
  } else if (extension.length > 0) {
    chatType = "extensions";
  }

  // save the user message
  await CreateChatMessage({
    name: user.name,
    content: props.message,
    role: "user",
    chatThreadId: currentChatThread.id,
    multiModalImage: props.multimodalImage,
  });

  // Validate deployment name exists
  if (!modelConfig.deploymentName) {
    console.error(`🔴 Missing deployment name for model ${selectedModel}. Check environment variables.`);
    return new Response(`Missing deployment configuration for model ${selectedModel}`, { status: 500 });
  }

  // Get the appropriate OpenAI instance based on selected model
  let openaiInstance;
  try {
    openaiInstance = modelConfig.getInstance();
  } catch (error) {
    console.error(`🔴 Failed to create OpenAI instance for model ${selectedModel}:`, error);
    return new Response(`Failed to initialize AI service for model ${selectedModel}`, { status: 500 });
  }

  // Enable Responses API for models that support it
  const useResponsesAPI = modelConfig.supportsResponsesAPI;
  
  let readableStream: ReadableStream;

  if (useResponsesAPI) {
    console.log("🚀 Using Azure OpenAI v1 Responses API for streaming");
    
    // Use the new Responses API for supported models
    const stream = await ChatApiResponses({
      chatThread: currentChatThread,
      userMessage: props.message,
      history: history,
      extensions: extension,
      signal: signal,
      openaiInstance: openaiInstance,
      reasoningEffort: reasoningEffort,
      multiModalImage: props.multimodalImage,
    });

    readableStream = OpenAIResponsesStream({
      stream: stream,
      chatThread: currentChatThread,
    });
  } else {
    console.log("🔄 Using legacy Chat Completions API for streaming");
    
    let runner: ChatCompletionStreamingRunner;    switch (chatType) {
      case "chat-with-file":
        runner = await ChatApiRAG({
          chatThread: currentChatThread,
          userMessage: props.message,
          history: history,
          signal: signal,
          reasoningEffort: reasoningEffort,
        });
        break;
      case "extensions":
        runner = await ChatApiExtensions({
          chatThread: currentChatThread,
          userMessage: props.message,
          history: history,
          extensions: extension,
          signal: signal,
          openaiInstance: openaiInstance,
          reasoningEffort: reasoningEffort,
        });
        break;
    }    readableStream = OpenAIStream({
      runner: runner,
      chatThread: currentChatThread,
    });

    // Legacy token reporting using manual calculation
    // Note: Responses API models use more accurate token data from response.completed events
    runner.on("finalContent", async (finalContent: string) => {
      const chatTokenService = new ChatTokenService();
      const tokens = chatTokenService.getTokenCount(finalContent);
      reportCompletionTokens(tokens, "gpt-4", {
        personaMessageTitle: currentChatThread.personaMessageTitle,
      });
    });
  }

  reportUserChatMessage("gpt-4", {
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

const _getHistory = async (chatThread: ChatThreadModel) => {
  const historyResponse = await FindTopChatMessagesForCurrentUser(
    chatThread.id
  );

  if (historyResponse.status === "OK") {
    const historyResults = historyResponse.response;
    return mapOpenAIChatMessages(historyResults).reverse();
  }

  console.error("🔴 Error on getting history:", historyResponse.errors);

  return [];
};

const _getDocuments = async (chatThread: ChatThreadModel) => {
  const docsResponse = await FindAllChatDocuments(chatThread.id);

  if (docsResponse.status === "OK") {
    return docsResponse.response;
  }

  console.error("🔴 Error on AI search:", docsResponse.errors);
  return [];
};

const _getExtensions = async (props: {
  chatThread: ChatThreadModel;
  userMessage: string;
  signal: AbortSignal;
}) => {
  const extension: Array<any> = [];

  const response = await GetDefaultExtensions({
    chatThread: props.chatThread,
    userMessage: props.userMessage,
    signal: props.signal,
  });
  if (response.status === "OK" && response.response.length > 0) {
    extension.push(...response.response);
  }

  const dynamicExtensionsResponse = await GetDynamicExtensions({
    extensionIds: props.chatThread.extension,
  });
  if (
    dynamicExtensionsResponse.status === "OK" &&
    dynamicExtensionsResponse.response.length > 0
  ) {
    extension.push(...dynamicExtensionsResponse.response);
  }

  return extension;
};
