// Constants for image reference format
const IMAGE_REFERENCE_PREFIX = "blob://";
const BASE64_IMAGE_PATTERN = /^data:image\/([a-zA-Z]+);base64,/;

/**
 * Detects if a string contains a base64 image
 */
export const isBase64Image = (content: string): boolean => {
  return BASE64_IMAGE_PATTERN.test(content);
};

/**
 * Extracts image metadata from base64 string
 */
export const extractImageMetadata = (base64Image: string): { mimeType: string; data: string } | null => {
  const match = base64Image.match(BASE64_IMAGE_PATTERN);
  if (!match) return null;
  
  const mimeType = match[1];
  const data = base64Image.substring(match[0].length);
  
  return { mimeType, data };
};

/**
 * Converts base64 image to Buffer
 */
export const base64ToBuffer = (base64Data: string): Buffer => {
  return Buffer.from(base64Data, 'base64');
};

/**
 * Checks if a string is an image reference
 */
export const isImageReference = (content: string): boolean => {
  return content.startsWith(IMAGE_REFERENCE_PREFIX);
};

/**
 * Parses image reference to extract threadId and imageId
 */
export const parseImageReference = (reference: string): { threadId: string; imageId: string; fileName: string; mimeType: string } | null => {
  if (!isImageReference(reference)) return null;
  
  const parts = reference.substring(IMAGE_REFERENCE_PREFIX.length).split('/');
  if (parts.length !== 2) return null;
  
  const [threadId, imageId] = parts;
  
  return {
    threadId,
    imageId,
    fileName: `${imageId}.png`, // Default to PNG for now
    mimeType: 'image/png'
  };
}; 