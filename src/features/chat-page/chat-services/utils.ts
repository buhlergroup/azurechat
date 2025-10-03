import { ResponseInputItem } from "openai/resources/responses/responses"
import { ChatMessageModel } from "./models";
import { getBase64ImageReference } from "./chat-image-persistence-service";

export const mapOpenAIChatMessages = async (
  messages: ChatMessageModel[]
): Promise<ResponseInputItem[]> => {
  const mappedMessages: ResponseInputItem[] = [];
  
  for (const message of messages) {
    // Skip roles not supported by the Responses API history (e.g., tool/function)
    if (message.role === "tool" || message.role === "function") {
      continue;
    }

    if (message.role === "user" && message.multiModalImage) {
      mappedMessages.push({
        type: "message",
        role: message.role as any,
        content: [
          { type: "input_text", text: message.content },
          { type: "input_image", image_url: await getBase64ImageReference(message.multiModalImage || "") },
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
          content: message.content,
        } as ResponseInputItem);
        break;
      default:
        mappedMessages.push({
          type: "message",
          role: message.role,
          content: message.content,
        } as ResponseInputItem);
        break;
    }
    
    if (message.role === "assistant" && message.reasoningState) {
      mappedMessages.push(
        message.reasoningState as ResponseInputItem
      );
    }
  }
  
  return mappedMessages;
};
