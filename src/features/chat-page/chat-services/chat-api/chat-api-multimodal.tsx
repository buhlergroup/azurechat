"use server";
import "server-only";

import { OpenAIVisionInstance } from "@/features/common/services/openai";
import { ChatCompletionStreamingRunner } from "openai/resources/chat/completions";
import { ChatThreadModel, MODEL_CONFIGS } from "../models";
export const ChatApiMultimodal = async (props: {
  chatThread: ChatThreadModel;
  userMessage: string;
  file: string;
  signal: AbortSignal;
  reasoningEffort?: string;
}): Promise<ChatCompletionStreamingRunner> => {
  const { chatThread, userMessage, signal, file, reasoningEffort } = props;

  // Get the appropriate OpenAI instance based on selected model
  const selectedModel = chatThread.selectedModel || "gpt-4.1";
  const modelConfig = MODEL_CONFIGS[selectedModel];
  
  // For reasoning models, use the reasoning instance, otherwise use vision instance
  const openAI = modelConfig.supportsReasoning ? modelConfig.getInstance() : OpenAIVisionInstance();

  const streamParams: any = {
    model: chatThread.selectedModel || "gpt-4o",
    stream: true,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          chatThread.personaMessage +
          "\n You are an expert in extracting insights from images that are uploaded to the chat. \n You will answer questions about the image that is provided.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: userMessage },
          {
            type: "image_url",
            image_url: {
              url: file,
            },
          },
        ],
      },
    ],
  };

  // Note: Azure OpenAI doesn't support reasoning parameters in Chat Completions API
  // Reasoning models will work but without explicit reasoning configuration
  if (modelConfig?.supportsReasoning) {
    console.log(`🧠 Using reasoning model ${chatThread.selectedModel} with multimodal via Chat Completions API (Azure OpenAI)`);
  }

  return openAI.chat.completions.stream(streamParams, { signal });
};
