"use client";

import { useEffect, useState } from "react";

interface AdvancedLoadingIndicatorProps {
  isLoading: boolean;
  loadingMessages: string[];
  interval?: number;
  className?: string;
  loop?: boolean;
}

export function AdvancedLoadingIndicator({
  isLoading,
  loadingMessages,
  interval = 2000,
  className = "",
  loop = false,
}: AdvancedLoadingIndicatorProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!isLoading || loadingMessages.length === 0) {
      setCurrentIndex(0);
      return;
    }

    setCurrentIndex(0);

    const timer = setInterval(() => {
      setCurrentIndex((prevIndex) => {
        const nextIndex = prevIndex + 1;
        if (nextIndex >= loadingMessages.length) {
          if (loop) {
            return 0;
          }
          clearInterval(timer);
          return prevIndex;
        }
        return nextIndex;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [isLoading, loadingMessages, interval, loop]);

  const displayedMessage =
    isLoading && loadingMessages.length > 0
      ? loadingMessages[currentIndex]
      : null;

  return (
    <div className={`animate-pulse text-sm ${className}`}>
      <span>{displayedMessage}</span>
    </div>
  );
}
