export const AGENT_STATS_ATTRIBUTE = "AGENT_STATS";

// Sentinel partition-key value (/userId) for all agent-stats docs: the
// chat-turn hook only knows the personaId (an owner lookup would cost a
// cross-partition read per turn), and readers can fetch every stats doc
// with a single-partition query. Write volume is far below hot-partition
// territory.
export const AGENT_STATS_PARTITION = "AGENT_STATS";

export const agentStatsDocId = (personaId: string): string =>
  `AGENT_STATS_${personaId}`;

// Global, atomically-incremented usage counters per agent — intentionally
// totals only, no time series.
export interface AgentStatsModel {
  id: string; // AGENT_STATS_${personaId}
  userId: typeof AGENT_STATS_PARTITION;
  type: typeof AGENT_STATS_ATTRIBUTE;
  personaId: string;
  chatCount: number; // threads started from this agent
  messageCount: number; // assistant turns (interactions)
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  lastUsedAt: string; // ISO timestamp
}

export const emptyAgentStats = (personaId: string): AgentStatsModel => ({
  id: agentStatsDocId(personaId),
  userId: AGENT_STATS_PARTITION,
  type: AGENT_STATS_ATTRIBUTE,
  personaId,
  chatCount: 0,
  messageCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCachedTokens: 0,
  lastUsedAt: new Date().toISOString(),
});

// Compact display formatting for counters (e.g. 1234 -> "1.2k").
export const formatCount = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${value}`;
};
