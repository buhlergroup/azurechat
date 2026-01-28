"use client";

import { Brain } from "lucide-react";
import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/ui/select";
import { ReasoningEffort } from "../chat-services/models";
import { useChat } from "../chat-store";

interface ReasoningEffortSelectorProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  disabled?: boolean;
  showReasoningModelsOnly?: boolean;
}

export const ReasoningEffortSelector: React.FC<ReasoningEffortSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  showReasoningModelsOnly = false,
}) => {
  const { webSearchEnabled, imageGenerationEnabled, companyContentEnabled, codeInterpreterEnabled } = useChat();
  const toolsEnabled = webSearchEnabled || imageGenerationEnabled || companyContentEnabled || codeInterpreterEnabled;

  if (!showReasoningModelsOnly) {
    return null;
  }

  const effortOptions = [
    {
      value: "minimal" as ReasoningEffort,
      label: "Minimal",
      description: "Fastest, minimal reasoning",
      disabled: toolsEnabled,
    },
    {
      value: "low" as ReasoningEffort,
      label: "Low",
      description: "Quick responses, basic reasoning",
      disabled: false,
    },
    {
      value: "medium" as ReasoningEffort,
      label: "Medium",
      description: "Balanced reasoning and speed",
      disabled: false,
    },
    {
      value: "high" as ReasoningEffort,
      label: "High",
      description: "Deep analysis, thorough reasoning",
      disabled: false,
    },
  ];

  return (
    <div className="flex items-center gap-2">
      <Brain size={16} className="text-blue-500" />
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue placeholder="Reasoning" />
        </SelectTrigger>
        <SelectContent>
          {effortOptions.map((option) => (
            <SelectItem 
              key={option.value} 
              value={option.value}
              disabled={option.disabled}
            >
              <div className="flex flex-col">
                <span className="font-medium">{option.label}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
