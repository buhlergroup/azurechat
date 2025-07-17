"use client";
import { Button } from "@/features/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/ui/dropdown-menu";
import { ChevronDown, Cpu, Zap } from "lucide-react";
import { FC, useEffect, useState } from "react";
import { ChatModel, MODEL_CONFIGS, getAvailableModels, ModelConfig } from "../chat-services/models";
import { logError } from "@/features/common/services/logger";

interface ModelSelectorProps {
  selectedModel: ChatModel;
  onModelChange: (model: ChatModel) => void;
  disabled?: boolean;
}

export const ModelSelector: FC<ModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
}) => {
  const [availableModels, setAvailableModels] = useState<Record<ChatModel, ModelConfig>>(MODEL_CONFIGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAvailableModels = async () => {
      try {
        const models = await getAvailableModels();
        setAvailableModels(models);
      } catch (error) {
        logError('Error fetching available models', { error: error instanceof Error ? error.message : String(error) });
        // Fallback to all models if API fails
        setAvailableModels(MODEL_CONFIGS);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailableModels();
  }, []);

  const currentModel = MODEL_CONFIGS[selectedModel];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || loading}
          className="flex items-center gap-2 h-8"
        >
          {currentModel?.supportsReasoning ? (
            <Cpu size={14} />
          ) : (
            <Zap size={14} />
          )}
          <span className="text-sm">{currentModel?.name || selectedModel}</span>
          <ChevronDown size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {loading ? (
          <DropdownMenuItem disabled className="p-3">
            Loading models...
          </DropdownMenuItem>
        ) : (
          Object.values(availableModels).map((model) => (
            <DropdownMenuItem
              key={model.id}
              onClick={() => onModelChange(model.id)}
              className="flex items-start gap-3 p-3 cursor-pointer"
            >
              <div className="flex-shrink-0 mt-0.5">
                {model.supportsReasoning ? (
                  <Cpu size={16} className="text-blue-600" />
                ) : (
                  <Zap size={16} className="text-green-600" />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{model.name}</span>
                  {selectedModel === model.id && (
                    <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                      Selected
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {model.description}
                </span>
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
