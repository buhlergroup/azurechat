/**
 * usage-data.ts
 *
 * Shared, side-effect-free computation of the per-request token-usage block
 * the chat header displays (token count, cost estimate, context-window %).
 *
 * Why this exists: the AI SDK v6 migration left the live usage wiring
 * dangling. The store action `setUsageData` was never called on the live
 * path, so the header's `lastUsageData` only ever reflected the value seeded
 * at page load — total tokens updated only after a reload, and per-request
 * input/output always showed 0. The route now ships this block to the client
 * via `toUIMessageStreamResponse({ messageMetadata })` and the chat session's
 * `onFinish` feeds it into the store, so the header updates every turn.
 *
 * The THREAD running totals (threadTotalTokens / threadTotalCostUsd) are NOT
 * computed here: the server-side Cosmos read-modify-write that owns them runs
 * in a different path (persist-assistant). The client merges this per-request
 * block onto the totals it already holds; a reload reconciles from the
 * persisted thread usage. Keeping this pure means it's identical across the
 * Azure (Responses) and Anthropic (Messages) providers — usage is normalised
 * to inputTokens/outputTokens by the SDK before it reaches us.
 */
import type { ModelConfig } from "../models";

/** Per-request usage block carried on assistant-message metadata. */
export interface RequestUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  contextWindowSize: number;
  contextUsagePercent: number;
  model: string;
}

/** Metadata attached to streamed assistant messages. */
export interface ChatMessageMetadata {
  usage?: RequestUsageMetadata;
}

export interface ComputeRequestUsageArgs {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  modelConfig: Pick<ModelConfig, "id" | "pricing" | "contextWindow">;
}

/**
 * Compute the per-request usage block from raw token counts. Cost mirrors
 * persist-assistant exactly: cached input is billed at the cached rate, the
 * remaining input at the standard rate, output at the output rate.
 */
export function computeRequestUsage({
  inputTokens,
  outputTokens,
  cachedTokens,
  modelConfig,
}: ComputeRequestUsageArgs): RequestUsageMetadata {
  const pricing = modelConfig.pricing;
  let costUsd = 0;
  if (pricing) {
    const nonCachedInput = Math.max(inputTokens - cachedTokens, 0);
    costUsd =
      (nonCachedInput / 1_000_000) * pricing.inputPerMillion +
      (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion +
      (outputTokens / 1_000_000) * pricing.outputPerMillion;
  }

  const contextWindowSize = modelConfig.contextWindow ?? 0;
  const contextUsagePercent =
    contextWindowSize > 0 ? (inputTokens / contextWindowSize) * 100 : 0;

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    contextWindowSize,
    contextUsagePercent,
    model: modelConfig.id,
  };
}
