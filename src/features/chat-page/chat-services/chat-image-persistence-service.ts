"use server";
import "server-only";

import { ServerActionResponse } from "@/features/common/server-action-response";
import { UploadImageToStore, GetImageUrl } from "./chat-image-service";
import { uniqueId } from "@/features/common/util";
import { logInfo, logError, logDebug } from "@/features/common/services/logger";
import { 
  isBase64Image, 
  extractImageMetadata, 
  base64ToBuffer, 
  isImageReference, 
  parseImageReference 
} from "./chat-image-persistence-utils";

// Store image metadata to map imageId to file extension
const imageMetadataMap = new Map<string, { extension: string; mimeType: string }>();

/**
 * Stores base64 image to blob storage and returns a reference
 */
export const persistBase64Image = async (
  threadId: string,
  base64Image: string
): Promise<ServerActionResponse<string>> => {
  try {
    const metadata = extractImageMetadata(base64Image);
    if (!metadata) {
      logError("Invalid base64 image format", { threadId });
      return {
        status: "ERROR",
        errors: [{ message: "Invalid base64 image format" }]
      };
    }

    const { mimeType, data } = metadata;
    const imageBuffer = base64ToBuffer(data);
    const imageId = uniqueId();
    const fileName = `${imageId}.${mimeType}`;

    // Store metadata for later retrieval
    imageMetadataMap.set(imageId, { extension: mimeType, mimeType: `image/${mimeType}` });

    logDebug("Persisting base64 image to blob storage", {
      threadId,
      imageId,
      fileName,
      mimeType,
      dataSize: imageBuffer.length
    });

    const uploadResult = await UploadImageToStore(threadId, fileName, imageBuffer);
    
    if (uploadResult.status !== "OK") {
      logError("Failed to upload image to blob storage", {
        threadId,
        imageId,
        errors: uploadResult.errors
      });
      return uploadResult;
    }

    // Create reference format: blob://threadId/imageId
    const reference = `blob://${threadId}/${imageId}`;
    
    logInfo("Successfully persisted base64 image", {
      threadId,
      imageId,
      fileName,
      reference
    });

    return {
      status: "OK",
      response: reference
    };

  } catch (error) {
    logError("Error persisting base64 image", {
      error: error instanceof Error ? error.message : String(error),
      threadId
    });
    return {
      status: "ERROR",
      errors: [{ message: `Failed to persist image: ${error}` }]
    };
  }
};

/**
 * Converts image reference back to URL for API consumption
 */
export const resolveImageReference = async (reference: string): Promise<ServerActionResponse<string>> => {
  try {
    const imageRef = parseImageReference(reference);
    if (!imageRef) {
      return {
        status: "ERROR",
        errors: [{ message: "Invalid image reference format" }]
      };
    }

    // Get the blob URL for the image
    const imageUrl = await GetImageUrl(imageRef.threadId, imageRef.fileName);
    
    logDebug("Resolved image reference", {
      reference,
      imageUrl,
      threadId: imageRef.threadId,
      imageId: imageRef.imageId
    });

    return {
      status: "OK",
      response: imageUrl
    };

  } catch (error) {
    logError("Error resolving image reference", {
      error: error instanceof Error ? error.message : String(error),
      reference
    });
    return {
      status: "ERROR",
      errors: [{ message: `Failed to resolve image reference: ${error}` }]
    };
  }
};

/**
 * Processes message content to detect and persist base64 images
 */
export const processMessageForImagePersistence = async (
  threadId: string,
  content: string,
  multiModalImage?: string
): Promise<{ content: string; multiModalImage?: string }> => {
  let processedContent = content;
  let processedMultiModalImage = multiModalImage;

  // Process main content for base64 images
  if (isBase64Image(content)) {
    logDebug("Detected base64 image in message content", { threadId });
    const persistResult = await persistBase64Image(threadId, content);
    if (persistResult.status === "OK") {
      processedContent = persistResult.response;
    }
  }

  // Process multiModalImage if present
  if (multiModalImage && isBase64Image(multiModalImage)) {
    logDebug("Detected base64 image in multiModalImage", { threadId });
    const persistResult = await persistBase64Image(threadId, multiModalImage);
    if (persistResult.status === "OK") {
      processedMultiModalImage = persistResult.response;
    }
  }

  return {
    content: processedContent,
    multiModalImage: processedMultiModalImage
  };
};

/**
 * Processes message content to resolve image references back to URLs
 */
export const processMessageForImageResolution = async (
  content: string,
  multiModalImage?: string
): Promise<{ content: string; multiModalImage?: string }> => {
  let resolvedContent = content;
  let resolvedMultiModalImage = multiModalImage;

  // Resolve image references in main content
  if (isImageReference(content)) {
    logDebug("Resolving image reference in message content");
    const resolveResult = await resolveImageReference(content);
    if (resolveResult.status === "OK") {
      resolvedContent = resolveResult.response;
    }
  }

  // Resolve image references in multiModalImage
  if (multiModalImage && isImageReference(multiModalImage)) {
    logDebug("Resolving image reference in multiModalImage");
    const resolveResult = await resolveImageReference(multiModalImage);
    if (resolveResult.status === "OK") {
      resolvedMultiModalImage = resolveResult.response;
    }
  }

  return {
    content: resolvedContent,
    multiModalImage: resolvedMultiModalImage
  };
}; 