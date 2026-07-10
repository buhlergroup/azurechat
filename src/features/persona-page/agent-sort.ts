import { AgentStatsModel } from "@/features/common/services/agent-stats-models";
import { PersonaModel } from "./persona-services/models";

export type AgentSortKey = "mostUsed" | "recentlyUpdated" | "newest" | "name";

export const AGENT_SORT_OPTIONS: Array<{
  value: AgentSortKey;
  label: string;
}> = [
  { value: "mostUsed", label: "Most used" },
  { value: "recentlyUpdated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name (A-Z)" },
];

const timestamp = (date?: Date | string): number =>
  date ? new Date(date).getTime() : 0;

const lastModified = (persona: PersonaModel): number =>
  timestamp(persona.updatedAt) || timestamp(persona.createdAt);

export const sortAgents = (
  personas: PersonaModel[],
  key: AgentSortKey,
  stats?: Record<string, AgentStatsModel>
): PersonaModel[] => {
  return [...personas].sort((a, b) => {
    switch (key) {
      case "name":
        return a.name.localeCompare(b.name);
      case "newest":
        return timestamp(b.createdAt) - timestamp(a.createdAt);
      case "recentlyUpdated":
        return lastModified(b) - lastModified(a);
      case "mostUsed": {
        const statsA = stats?.[a.id];
        const statsB = stats?.[b.id];
        return (
          (statsB?.messageCount ?? 0) - (statsA?.messageCount ?? 0) ||
          (statsB?.chatCount ?? 0) - (statsA?.chatCount ?? 0) ||
          lastModified(b) - lastModified(a)
        );
      }
    }
  });
};
