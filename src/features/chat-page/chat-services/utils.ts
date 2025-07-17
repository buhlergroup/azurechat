import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionFunctionMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { ChatMessageModel } from "./models";
import { processMessageForImageResolution } from "./chat-image-persistence-service";

export const mapOpenAIChatMessages = async (
  messages: ChatMessageModel[]
): Promise<ChatCompletionMessageParam[]> => {
  const mappedMessages: ChatCompletionMessageParam[] = [];
  
  for (const message of messages) {
    // Resolve image references before mapping
    const resolvedMessage = await processMessageForImageResolution(
      message.content,
      message.multiModalImage
    );

    // Handle multimodal content for user messages with images
    if (message.role === "user" && resolvedMessage.multiModalImage) {
      mappedMessages.push({
        role: message.role,
        content: [
          { type: "text", text: resolvedMessage.content },
          { type: "image_url", image_url: { url: resolvedMessage.multiModalImage } }
        ]
      });
      continue;
    }
    
    // Handle other message types...
    switch (message.role) {
      case "function":
        mappedMessages.push({
          role: message.role,
          name: message.name,
          content: resolvedMessage.content,
        } as ChatCompletionFunctionMessageParam);
        break;
      case "assistant":
        mappedMessages.push({
          role: message.role,
          content: resolvedMessage.content,
        } as ChatCompletionAssistantMessageParam);
        break;
      default:
        mappedMessages.push({
          role: message.role,
          content: resolvedMessage.content,
        } as ChatCompletionMessageParam);
        break;
    }
  }
  
  return mappedMessages;
};
