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
 * Reference format: blob://threadId/imageId.extension
 */
export const parseImageReference = (reference: string): { threadId: string; imageId: string; fileName: string; mimeType: string } | null => {
  if (!isImageReference(reference)) return null;
  
  const parts = reference.substring(IMAGE_REFERENCE_PREFIX.length).split('/');
  if (parts.length !== 2) return null;
  
  const [threadId, fileNameWithExt] = parts;
  
  // Extract extension from fileName (e.g., "imageId.jpeg" -> "jpeg")
  const lastDotIndex = fileNameWithExt.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? fileNameWithExt.substring(lastDotIndex + 1) : 'png';
  const imageId = lastDotIndex !== -1 ? fileNameWithExt.substring(0, lastDotIndex) : fileNameWithExt;
  
  return {
    threadId,
    imageId,
    fileName: fileNameWithExt, // Full filename with extension
    mimeType: `image/${extension}`
  };
};

/**
 * Converts an image URL back to a blob reference
 * Example: 'http://localhost:3000/api/images/?t=qWUM1VB&img=sihOs3OfKkuuJQNEwJzaKuMVfHyBNhLjuEwF.png'
 * Returns: 'blob://qWUM1VB/sihOs3OfKkuuJQNEwJzaKuMVfHyBNhLjuEwF.png'
 */
export const getImageRefFromUrl = (imageUrl: string): string | null => {
  try {
    const url = new URL(imageUrl);
    const threadId = url.searchParams.get('t');
    const fileName = url.searchParams.get('img');
    
    if (!threadId || !fileName) {
      return null;
    }
    
    return `${IMAGE_REFERENCE_PREFIX}${threadId}/${fileName}`;
  } catch (error) {
    // Invalid URL format
    throw new Error("Invalid image URL format");
  }
}; 