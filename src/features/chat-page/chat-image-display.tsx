"use client";

import { useEffect, useState } from "react";
import { isImageReference } from "./chat-services/chat-image-persistence-utils";

interface ChatImageDisplayProps {
  imageUrl?: string;
  alt?: string;
  className?: string;
}

export const ChatImageDisplay: React.FC<ChatImageDisplayProps> = ({ 
  imageUrl, 
  alt = "Chat image", 
  className = "" 
}) => {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(imageUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setResolvedUrl(undefined);
      return;
    }

    // If it's already a URL (not a reference), use it directly
    if (!isImageReference(imageUrl)) {
      setResolvedUrl(imageUrl);
      return;
    }

    // If it's a reference, resolve it
    setIsLoading(true);
    setError(null);

    const resolveImageReference = async () => {
      try {
        // Extract threadId and imageId from the reference
        const reference = imageUrl.substring(7); // Remove "blob://" prefix
        const [threadId, imageId] = reference.split('/');
        
        if (!threadId || !imageId) {
          throw new Error("Invalid image reference format");
        }

        // Construct the API URL - we'll try common extensions
        const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
        const apiUrl = `/api/images?t=${threadId}&img=${imageId}.png`;
        
        setResolvedUrl(apiUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve image reference");
        console.error("Error resolving image reference:", err);
      } finally {
        setIsLoading(false);
      }
    };

    resolveImageReference();
  }, [imageUrl]);

  if (!imageUrl) {
    return null;
  }

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-4 ${className}`}>
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
        <span className="ml-2 text-sm text-gray-600">Loading image...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 text-red-600 text-sm ${className}`}>
        Error loading image: {error}
      </div>
    );
  }

  if (!resolvedUrl) {
    return null;
  }

  return (
    <img 
      src={resolvedUrl} 
      alt={alt} 
      className={`max-w-full h-auto rounded-md ${className}`}
      onError={() => setError("Failed to load image")}
    />
  );
}; 