"use server";
import "server-only";

import OpenAI from "openai";
import { RunnableToolFunction } from "openai/lib/RunnableFunction";
import { 
  ChatCompletionMessageParam,
  ChatCompletionStreamingRunner
} from "openai/resources/chat/completions";
import { OpenAIInstance } from "@/features/common/services/openai";
import { FindExtensionByID } from "@/features/extensions-page/extension-services/extension-service";
import { ChatThreadModel, MODEL_CONFIGS } from "../models";
import { ChatTokenService } from "@/features/common/services/chat-token-service";
import { reportPromptTokens } from "@/features/common/services/chat-metrics-service";
export const ChatApiExtensions = async (props: {
  chatThread: ChatThreadModel;
  userMessage: string;
  history: ChatCompletionMessageParam[];
  extensions: RunnableToolFunction<any>[];
  signal: AbortSignal;
  openaiInstance?: any;
  reasoningEffort?: string;
}): Promise<ChatCompletionStreamingRunner> => {
  const { userMessage, history, signal, chatThread, extensions, openaiInstance, reasoningEffort } = props;

  const openAI = openaiInstance || OpenAIInstance();
  const systemMessage = await extensionsSystemMessage(chatThread);

  const messages: ChatCompletionMessageParam[] =  [
    {
      role: "system",
      content: chatThread.personaMessage + "\n" + systemMessage,
    },
    ...history,
    {
      role: "user",
      content: userMessage,
    },
  ];
  
  const tokenService = new ChatTokenService();
  let promptTokens = tokenService.getTokenCountFromHistory(messages);

  for (const tokens of promptTokens) {
    reportPromptTokens(tokens.tokens, "gpt-4", tokens.role, {personaMessageTitle: chatThread.personaMessageTitle, messageCount: messages.length, threadId: chatThread.id});
  }

  for (const e of extensions) {
  
    let toolsText = "";
    toolsText += `${e.function.description} \n`;
    toolsText += `${JSON.stringify(e.function.name)} \n`;
    toolsText += `${JSON.stringify(e.function.parameters)} \n`;

    let toolsTokens = tokenService.getTokenCount(toolsText);
    reportPromptTokens(toolsTokens, "gpt-4", "tools", {"functionName": e.function.name || "", "personaMessageTitle": chatThread.personaMessageTitle, threadId: chatThread.id, messageCount: messages.length});
  }

  const requestOptions: any = {
    model: chatThread.selectedModel || "gpt-4o",
    stream: true,
    messages: messages,
    tools: extensions,
  };

  // Note: Azure OpenAI doesn't support reasoning parameters in Chat Completions API
  // Reasoning models will work but without explicit reasoning configuration
  const modelConfig = MODEL_CONFIGS[chatThread.selectedModel || "gpt-4.1"];
  if (modelConfig?.supportsReasoning) {
    console.log(`🧠 Using reasoning model ${chatThread.selectedModel} with Chat Completions API (Azure OpenAI)`);
  }

  return openAI.chat.completions.stream(requestOptions, { signal: signal });
};

const extensionsSystemMessage = async (chatThread: ChatThreadModel) => {
  let message = "";

  for (const e of chatThread.extension) {
    const extension = await FindExtensionByID(e);
    if (extension.status === "OK") {
      message += ` ${extension.response.executionSteps} \n`;
    }
  }

  return message;
};
