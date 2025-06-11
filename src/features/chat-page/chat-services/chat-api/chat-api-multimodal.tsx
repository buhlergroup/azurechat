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

  const openAI = OpenAIVisionInstance();

  const streamParams: any = {
    model: "",
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

  // Add reasoning configuration for reasoning models
  const modelConfig = MODEL_CONFIGS[chatThread.selectedModel || "gpt-4.1"];
  if (modelConfig?.supportsReasoning) {
    // Add reasoning effort if specified
    if (reasoningEffort) {
      streamParams.reasoning_effort = reasoningEffort;
    }
    
    console.log(`🧠 Configuring reasoning for multimodal with ${chatThread.selectedModel}:`, {
      effort: reasoningEffort || "medium",
      supportedSummarizers: modelConfig.supportedSummarizers
    });
  }

  return openAI.chat.completions.stream(streamParams, { signal });
};
