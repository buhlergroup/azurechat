"use server";
import "server-only";

import { OpenAIInstance } from "@/features/common/services/openai";
import { FindExtensionByID } from "@/features/extensions-page/extension-services/extension-service";
import { RunnableToolFunction } from "openai/lib/RunnableFunction";
import { ChatCompletionStreamingRunner } from "openai/resources/chat/completions";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
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
    model: "",
    stream: true,
    messages: messages,
    tools: extensions,
  };

  // Add reasoning configuration for reasoning models
  const modelConfig = MODEL_CONFIGS[chatThread.selectedModel || "gpt-4.1"];
  if (modelConfig?.supportsReasoning) {
    // Add reasoning effort if specified
    if (reasoningEffort) {
      requestOptions.reasoning_effort = reasoningEffort;
    }
    
    console.log(`🧠 Configuring reasoning for ${chatThread.selectedModel}:`, {
      effort: reasoningEffort || "medium",
      supportedSummarizers: modelConfig.supportedSummarizers
    });
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
