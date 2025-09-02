import { ResponseInputItem } from "openai/resources/responses/responses"
import { ChatMessageModel } from "./models";
import { processMessageForImageResolution } from "./chat-image-persistence-service";

export const mapOpenAIChatMessages = async (
  messages: ChatMessageModel[]
): Promise<ResponseInputItem[]> => {
  const mappedMessages: ResponseInputItem[] = [];
  
  for (const message of messages) {
    // Skip roles not supported by the Responses API history (e.g., tool/function)
    if (message.role === "tool" || message.role === "function") {
      continue;
    }

    // Resolve image references before mapping
    const resolvedMessage = await processMessageForImageResolution(
      message.content,
      message.multiModalImage
    )

  if (message.role === "user" && resolvedMessage.multiModalImage) {
      mappedMessages.push({
        type: "message",
        role: message.role as any,
        content: [
          { type: "input_text", text: resolvedMessage.content },
          { type: "input_image", image_url: resolvedMessage.multiModalImage },
        ] as any,
      } as ResponseInputItem);
      continue;
    }
    
    // Handle other message types...
    switch (message.role) {
      case "assistant":
        mappedMessages.push({
          type: "message",
          role: message.role as any,
          content: resolvedMessage.content,
        } as ResponseInputItem);
        break;
      default:
        mappedMessages.push({
          type: "message",
          role: message.role,
          content: resolvedMessage.content,
        } as ResponseInputItem);
        break;
    }
    
    if (message.role === "assistant" && message.reasoningState) {
      mappedMessages.push(
        message.reasoningState
      );
    }
  }
  
  return mappedMessages;
};
