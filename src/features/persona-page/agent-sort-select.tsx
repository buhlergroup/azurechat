"use client";

import { ArrowUpDown } from "lucide-react";
import { FC } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { AGENT_SORT_OPTIONS, AgentSortKey } from "./agent-sort";

interface AgentSortSelectProps {
  value: AgentSortKey;
  onChange: (value: AgentSortKey) => void;
}

export const AgentSortSelect: FC<AgentSortSelectProps> = ({
  value,
  onChange,
}) => {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as AgentSortKey)}
    >
      <SelectTrigger
        className="w-full sm:w-[190px]"
        aria-label="Sort agents"
      >
        {/* div (not span): the trigger's [&>span]:line-clamp-1 would clobber
            a span wrapper's flex display */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
          <SelectValue placeholder="Sort by" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {AGENT_SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
