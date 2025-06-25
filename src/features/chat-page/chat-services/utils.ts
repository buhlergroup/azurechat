import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionFunctionMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { ChatMessageModel } from "./models";

export const mapOpenAIChatMessages = (
  messages: ChatMessageModel[]
): ChatCompletionMessageParam[] => {
  return messages.map((message) => {
    // Handle multimodal content for user messages with images
    if (message.role === "user" && message.multiModalImage) {
      return {
        role: message.role,
        content: [
          { type: "text", text: message.content },
          { type: "image_url", image_url: { url: message.multiModalImage } }
        ]
      };
    }
    
    // Handle other message types...
    switch (message.role) {
      case "function":
        return {
          role: message.role,
          name: message.name,
          content: message.content,
        } as ChatCompletionFunctionMessageParam;
      case "assistant":
        return {
          role: message.role,
          content: message.content,
        } as ChatCompletionAssistantMessageParam;
      default:
        return {
          role: message.role,
          content: message.content,
        } as ChatCompletionMessageParam;
    }
  });
};
