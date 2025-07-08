import React from "react";
import { X } from "lucide-react";

interface ToolCallHistorySidebarProps {
  open: boolean;
  onClose: () => void;
  toolCallHistory: Array<{ name: string; arguments: string; result?: string; timestamp: Date }>;
  messageId: string;
}

const ToolCallHistorySidebar: React.FC<ToolCallHistorySidebarProps> = ({ open, onClose, toolCallHistory, messageId }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      {/* Sidebar */}
      <div className="relative ml-auto w-full max-w-md h-full bg-white dark:bg-slate-900 shadow-xl p-6 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Tool Call History</h2>
          <button onClick={onClose} className="p-2 rounded hover:bg-accent">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-4">
          {toolCallHistory.length === 0 ? (
            <div className="text-muted-foreground text-sm">No tool calls for this message.</div>
          ) : (
            toolCallHistory.map((toolCall, idx) => (
              <div key={idx} className="border-l-2 border-orange-300 pl-3">
                <div className="font-medium text-orange-600 dark:text-orange-400">
                  {toolCall.name}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Arguments: {toolCall.arguments}
                </div>
                {toolCall.result && (
                  <div className="text-xs text-gray-500 mt-1">
                    Result: {toolCall.result.substring(0, 200)}...
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-1">
                  {toolCall.timestamp instanceof Date ? toolCall.timestamp.toLocaleTimeString() : String(toolCall.timestamp)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ToolCallHistorySidebar; 