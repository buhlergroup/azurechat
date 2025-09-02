"use server";
import "server-only";

import { userHashedId } from "@/features/auth-page/helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { uniqueId } from "@/features/common/util";
import { SqlQuerySpec } from "@azure/cosmos";
import { HistoryContainer } from "../../common/services/cosmos";
import { ChatMessageModel, ChatRole, MESSAGE_ATTRIBUTE } from "./models";
import { logDebug } from "@/features/common/services/logger";
import { processMessageForImagePersistence, processMessageForImageResolution } from "./chat-image-persistence-service";

export const FindTopChatMessagesForCurrentUser = async (
  chatThreadID: string,
  top: number = 30
): Promise<ServerActionResponse<Array<ChatMessageModel>>> => {
  try {
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT TOP @top * FROM root r WHERE r.type=@type AND r.threadId = @threadId AND r.userId=@userId AND r.isDeleted=@isDeleted ORDER BY r.createdAt DESC",
      parameters: [
        {
          name: "@type",
          value: MESSAGE_ATTRIBUTE,
        },
        {
          name: "@threadId",
          value: chatThreadID,
        },
        {
          name: "@userId",
          value: await userHashedId(),
        },
        {
          name: "@isDeleted",
          value: false,
        },
        {
          name: "@top",
          value: top,
        },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<ChatMessageModel>(querySpec)
      .fetchAll();

    return {
      status: "OK",
      response: resources,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const FindAllChatMessagesForCurrentUser = async (
  chatThreadID: string
): Promise<ServerActionResponse<Array<ChatMessageModel>>> => {
  try {
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT * FROM root r WHERE r.type=@type AND r.threadId = @threadId AND r.userId=@userId AND  r.isDeleted=@isDeleted ORDER BY r.createdAt ASC",
      parameters: [
        {
          name: "@type",
          value: MESSAGE_ATTRIBUTE,
        },
        {
          name: "@threadId",
          value: chatThreadID,
        },
        {
          name: "@userId",
          value: await userHashedId(),
        },
        {
          name: "@isDeleted",
          value: false,
        },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<ChatMessageModel>(querySpec)
      .fetchAll();

    logDebug("Chat Messages Loaded", {
      threadId: chatThreadID,
      count: resources.length,
      userId: userHashedId
    });

    return {
      status: "OK",
      response: resources,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const CreateChatMessage = async ({
  name,
  content,
  role,
  chatThreadId,
  multiModalImage,
  reasoningContent,
  reasoningState
}: {
  name: string;
  role: ChatRole;
  content: string;
  chatThreadId: string;
  multiModalImage?: string;
  reasoningContent?: string;
  reasoningState?: any;
}): Promise<ServerActionResponse<ChatMessageModel>> => {
  const userId = await userHashedId();

  // Process images for persistence before saving
  const processedMessage = await processMessageForImagePersistence(
    chatThreadId,
    content,
    multiModalImage
  );

  const modelToSave: ChatMessageModel = {
    id: uniqueId(),
    createdAt: new Date(),
    type: MESSAGE_ATTRIBUTE,
    isDeleted: false,
    content: processedMessage.content,
    name: name,
    role: role,
    threadId: chatThreadId,
    userId: userId,
    multiModalImage: processedMessage.multiModalImage,
    reasoningContent: reasoningContent,
    reasoningState: reasoningState,
  };
  return await UpsertChatMessage(modelToSave);
};

export const UpsertChatMessage = async (
  chatModel: ChatMessageModel
): Promise<ServerActionResponse<ChatMessageModel>> => {
  try {
    // Process images for persistence before saving
    const processedMessage = await processMessageForImagePersistence(
      chatModel.threadId,
      chatModel.content,
      chatModel.multiModalImage
    );

    const modelToSave: ChatMessageModel = {
      ...chatModel,
      id: chatModel.id || uniqueId(), // Use existing ID if provided, otherwise generate new one
      createdAt: chatModel.createdAt || new Date(), // Use existing createdAt if provided
      type: MESSAGE_ATTRIBUTE,
      isDeleted: false,
      content: processedMessage.content,
      multiModalImage: processedMessage.multiModalImage,
    };

    logDebug("Upserting chat message", {
      id: modelToSave.id,
      role: modelToSave.role,
      contentLength: modelToSave.content?.length || 0,
      hasReasoningContent: !!modelToSave.reasoningContent,
      threadId: modelToSave.threadId
    });

    const { resource } =
      await HistoryContainer().items.upsert<ChatMessageModel>(modelToSave);

    if (resource) {
      return {
        status: "OK",
        response: resource,
      };
    }

    return {
      status: "ERROR",
      errors: [
        {
          message: `Chat message not found`,
        },
      ],
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const UpdateChatMessage = async (
  messageId: string,
  updates: Partial<ChatMessageModel>
): Promise<ServerActionResponse<ChatMessageModel>> => {
  try {
    // First, find the existing message
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT * FROM root r WHERE r.type=@type AND r.id=@id AND r.userId=@userId AND r.isDeleted=@isDeleted",
      parameters: [
        {
          name: "@type",
          value: MESSAGE_ATTRIBUTE,
        },
        {
          name: "@id",
          value: messageId,
        },
        {
          name: "@userId",
          value: await userHashedId(),
        },
        {
          name: "@isDeleted",
          value: false,
        },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<ChatMessageModel>(querySpec)
      .fetchAll();

    if (resources.length === 0) {
      return {
        status: "NOT_FOUND",
        errors: [{ message: `Chat message not found` }],
      };
    }

    const existingMessage = resources[0];
    const updatedMessage: ChatMessageModel = {
      ...existingMessage,
      ...updates,
      id: existingMessage.id, // Preserve original ID
      createdAt: existingMessage.createdAt, // Preserve original creation time
      type: MESSAGE_ATTRIBUTE,
      isDeleted: false,
    };

    logDebug("Updating chat message", {
      id: updatedMessage.id,
      messageId,
      role: updatedMessage.role,
      contentLength: updatedMessage.content?.length || 0,
      hasReasoningContent: !!updatedMessage.reasoningContent,
      threadId: updatedMessage.threadId
    });

    const { resource } = await HistoryContainer().items.upsert<ChatMessageModel>(updatedMessage);

    if (resource) {
      return {
        status: "OK",
        response: resource,
      };
    }

    return {
      status: "ERROR",
      errors: [
        {
          message: `Failed to update chat message`,
        },
      ],
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};
