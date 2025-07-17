import React from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/features/ui/dialog";

interface ToolCallHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  toolCallHistory: Array<{ name: string; arguments: string; result?: string; timestamp: Date }>;
  messageId: string;
}

const ToolCallHistoryDialog: React.FC<ToolCallHistoryDialogProps> = ({ open, onClose, toolCallHistory, messageId }) => {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Tool Call History</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-accent">
              <X size={20} />
            </button>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {toolCallHistory.length === 0 ? (
            <div className="text-muted-foreground text-sm">No tool calls for this message.</div>
          ) : (
            toolCallHistory.map((toolCall, idx) => (
              <div key={idx} className="border-l-2 border-orange-300 pl-3">
                <div className="font-medium text-orange-600 dark:text-orange-400">
                  {toolCall.name}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  <strong>Arguments:</strong>
                  <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto">
                    {toolCall.arguments}
                  </pre>
                </div>
                {toolCall.result && (
                  <div className="text-xs text-gray-500 mt-2">
                    <strong>Result:</strong>
                    <pre className="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto">
                      {toolCall.result.substring(0, 500)}...
                    </pre>
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-1">
                  {toolCall.timestamp instanceof Date ? toolCall.timestamp.toLocaleTimeString() : String(toolCall.timestamp)}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ToolCallHistoryDialog; 