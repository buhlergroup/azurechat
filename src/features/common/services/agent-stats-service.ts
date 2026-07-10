"use server";
import "server-only";

import { PatchOperation, SqlQuerySpec } from "@azure/cosmos";
import {
  AGENT_STATS_ATTRIBUTE,
  AGENT_STATS_PARTITION,
  AgentStatsModel,
  agentStatsDocId,
  emptyAgentStats,
} from "./agent-stats-models";
import { HistoryContainer } from "./cosmos";
import { logError } from "./logger";

/**
 * Atomic counter update for an agent-stats doc via the Cosmos Patch API
 * (`incr` is applied server-side, so concurrent turns never lose updates —
 * unlike the read-modify-write upserts used for per-user usage docs).
 *
 * Patch first; on 404 create the doc pre-seeded with this event's values
 * (no second round-trip); if the create races another writer (409), the doc
 * now exists, so re-patch.
 */
const patchWithCreateFallback = async (
  personaId: string,
  operations: PatchOperation[],
  seed: AgentStatsModel
): Promise<void> => {
  const container = HistoryContainer();
  const docId = agentStatsDocId(personaId);
  try {
    await container.item(docId, AGENT_STATS_PARTITION).patch(operations);
  } catch (error: unknown) {
    if ((error as { code?: number }).code !== 404) throw error;
    try {
      await container.items.create<AgentStatsModel>(seed);
    } catch (createError: unknown) {
      if ((createError as { code?: number }).code !== 409) throw createError;
      // Lost the create race — the doc exists now, apply the increments.
      await container.item(docId, AGENT_STATS_PARTITION).patch(operations);
    }
  }
};

/**
 * Records that a new chat thread was started from an agent.
 * Fire-and-forget on the hot path: never throws, only logs.
 */
export const RecordAgentChatStarted = async (
  personaId: string
): Promise<void> => {
  const now = new Date().toISOString();
  try {
    await patchWithCreateFallback(
      personaId,
      [
        { op: "incr", path: "/chatCount", value: 1 },
        { op: "set", path: "/lastUsedAt", value: now },
      ],
      { ...emptyAgentStats(personaId), chatCount: 1, lastUsedAt: now }
    );
  } catch (error) {
    logError("agent-stats: RecordAgentChatStarted failed", {
      personaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Records one completed assistant turn (interaction) and its token usage.
 * Fire-and-forget on the hot path: never throws, only logs.
 */
export const RecordAgentInteraction = async (
  personaId: string,
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number }
): Promise<void> => {
  const now = new Date().toISOString();
  try {
    await patchWithCreateFallback(
      personaId,
      // 5 operations — Cosmos allows up to 10 per patch.
      [
        { op: "incr", path: "/messageCount", value: 1 },
        { op: "incr", path: "/totalInputTokens", value: usage.inputTokens },
        { op: "incr", path: "/totalOutputTokens", value: usage.outputTokens },
        { op: "incr", path: "/totalCachedTokens", value: usage.cachedTokens },
        { op: "set", path: "/lastUsedAt", value: now },
      ],
      {
        ...emptyAgentStats(personaId),
        messageCount: 1,
        totalInputTokens: usage.inputTokens,
        totalOutputTokens: usage.outputTokens,
        totalCachedTokens: usage.cachedTokens,
        lastUsedAt: now,
      }
    );
  } catch (error) {
    logError("agent-stats: RecordAgentInteraction failed", {
      personaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * All agent stats keyed by personaId — a single-partition query (sentinel
 * partition), never a container scan. Errors degrade to an empty map so
 * pages render without stats rather than failing.
 */
export const GetAllAgentStats = async (): Promise<
  Record<string, AgentStatsModel>
> => {
  try {
    const querySpec: SqlQuerySpec = {
      query: "SELECT * FROM root r WHERE r.type=@type AND r.userId=@pk",
      parameters: [
        { name: "@type", value: AGENT_STATS_ATTRIBUTE },
        { name: "@pk", value: AGENT_STATS_PARTITION },
      ],
    };
    const { resources } = await HistoryContainer()
      .items.query<AgentStatsModel>(querySpec, {
        partitionKey: AGENT_STATS_PARTITION,
      })
      .fetchAll();
    return Object.fromEntries(resources.map((s) => [s.personaId, s]));
  } catch (error) {
    logError("agent-stats: GetAllAgentStats failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
};

/** Best-effort cleanup when an agent is deleted; a missing doc is fine. */
export const DeleteAgentStats = async (personaId: string): Promise<void> => {
  try {
    await HistoryContainer()
      .item(agentStatsDocId(personaId), AGENT_STATS_PARTITION)
      .delete();
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 404) return;
    logError("agent-stats: DeleteAgentStats failed", {
      personaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
