import { LoadingIndicator } from "../../loading";
import { useCurrentToolCall } from "@/features/chat-page/chat-store";
import { Wrench } from "lucide-react";

export const ChatLoading = () => {
  const currentToolCall = useCurrentToolCall();

  console.debug("🔧 ChatLoading: Current tool call", {
    hasToolCall: !!currentToolCall,
    toolCallName: currentToolCall?.name,
    toolCallArgs: currentToolCall?.arguments,
    timestamp: new Date().toISOString()
  });

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <LoadingIndicator isLoading={true} />
      
      {currentToolCall ? (
        <div className="flex flex-col items-center space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center space-x-2">
            <Wrench size={16} className="text-orange-500" />
            <span>
              <strong>🔧 Tool Call:</strong> {currentToolCall.name}
            </span>
          </div>
          {currentToolCall.arguments && (
            <div className="text-xs text-muted-foreground/70 max-w-md truncate">
              Args: {currentToolCall.arguments}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          Thinking...
        </div>
      )}
    </div>
  );
};
