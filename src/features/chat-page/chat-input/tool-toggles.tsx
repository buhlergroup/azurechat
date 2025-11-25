"use client";

import { Button } from "@/features/ui/button";
import { Globe, ImageIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/features/ui/tooltip";
import { chatStore, useChat } from "../chat-store";
import { cn } from "@/ui/lib";

export const ToolToggles = () => {
  const { webSearchEnabled, imageGenerationEnabled, loading } = useChat();

  return (
    <div className="flex gap-1 items-center">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={webSearchEnabled ? "default" : "ghost"}
              size="icon"
              className={cn("h-8 w-8", webSearchEnabled && "bg-primary text-primary-foreground")}
              onClick={() => chatStore.toggleWebSearch(!webSearchEnabled)}
              disabled={loading === "loading"}
            >
              <Globe className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent 
            side="top" 
            align="start" 
            sideOffset={5} 
            collisionPadding={{ left: 16, right: 16, top: 8, bottom: 8 }}
            avoidCollisions={true}
          >
            <p>Web Search</p>
            <p className="text-xs text-muted-foreground">
              Search the web for real-time information
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={imageGenerationEnabled ? "default" : "ghost"}
              size="icon"
              className={cn("h-8 w-8", imageGenerationEnabled && "bg-primary text-primary-foreground")}
              onClick={() => chatStore.toggleImageGeneration(!imageGenerationEnabled)}
              disabled={loading === "loading"}
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent 
            side="top" 
            align="start" 
            sideOffset={5} 
            collisionPadding={{ left: 16, right: 16, top: 8, bottom: 8 }}
            avoidCollisions={true}
          >
            <p>Image Generation</p>
            <p className="text-xs text-muted-foreground">
              Generate images
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
