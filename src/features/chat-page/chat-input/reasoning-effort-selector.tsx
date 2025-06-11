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
import { Button } from "@/features/ui/button";
import { ReasoningEffort } from "../chat-services/models";

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
  if (!showReasoningModelsOnly) {
    return null;
  }

  const effortOptions = [
    {
      value: "low" as ReasoningEffort,
      label: "Low",
      description: "Quick responses, basic reasoning",
    },
    {
      value: "medium" as ReasoningEffort,
      label: "Medium",
      description: "Balanced reasoning and speed",
    },
    {
      value: "high" as ReasoningEffort,
      label: "High",
      description: "Deep analysis, thorough reasoning",
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
            <SelectItem key={option.value} value={option.value}>
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
