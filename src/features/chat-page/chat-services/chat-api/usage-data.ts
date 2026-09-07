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
import type { ModelConfig, ModelPricing } from "../models";

/** Per-request usage block carried on assistant-message metadata. */
export interface RequestUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Input tokens the provider wrote INTO the prompt cache this turn. */
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  contextWindowSize: number;
  contextUsagePercent: number;
  model: string;
}

export interface TokenCostArgs {
  /** Total input tokens, INCLUDING the cached-read and cache-write portions. */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the prompt cache (billed at the cached rate). */
  cachedTokens: number;
  /** Input tokens written into the prompt cache (billed at the write rate). */
  cacheWriteTokens?: number;
  pricing: ModelPricing | undefined;
}

/**
 * The one cost formula. Every caller (live usage metadata, the persisted
 * thread rollup, the sub-agent tool) routes through here so a price-table
 * change can never land in one place and not the others.
 *
 *   (input − cached − write) x input + cached x cachedInput
 *     + write x cacheWrite + output x output
 *
 * `cacheWritePerMillion` is absent on models that don't surcharge cache
 * writes (gpt-5.5 and older, and the Foundry models). For those the write
 * token count is treated as zero, which leaves those tokens in the
 * uncached-input bucket at the normal input rate — that is exactly how the
 * provider bills them. GPT-5.6 and Anthropic both pull them out into a
 * separately-priced bucket (1.25x uncached input).
 *
 * NOTE on the clamp below: the buckets are assumed DISJOINT and contained in
 * `inputTokens`, which is what both provider adapters guarantee at the pinned
 * SDK versions (@ai-sdk/openai reports cacheRead/cacheWrite as subsets of the
 * total; @ai-sdk/anthropic re-totals input + cacheCreation + cacheRead). A
 * provider that ever reported overlapping buckets would be over-billed here
 * rather than under-billed — deliberate, since a negative bucket would
 * under-state the cost silently.
 */
export function computeTokenCostUsd({
  inputTokens,
  outputTokens,
  cachedTokens,
  cacheWriteTokens = 0,
  pricing,
}: TokenCostArgs): number {
  if (!pricing) return 0;
  const writeTokens =
    pricing.cacheWritePerMillion !== undefined ? cacheWriteTokens : 0;
  const nonCachedInput = Math.max(inputTokens - cachedTokens - writeTokens, 0);
  return (
    (nonCachedInput / 1_000_000) * pricing.inputPerMillion +
    (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion +
    (writeTokens / 1_000_000) * (pricing.cacheWritePerMillion ?? 0) +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

/** Metadata attached to streamed assistant messages. */
export interface ChatMessageMetadata {
  usage?: RequestUsageMetadata;
}

export interface ComputeRequestUsageArgs {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens?: number;
  modelConfig: Pick<ModelConfig, "id" | "pricing" | "contextWindow">;
}

/**
 * Compute the per-request usage block from raw token counts. Cost comes from
 * the shared computeTokenCostUsd so this block and the persisted thread
 * rollup can never disagree.
 */
export function computeRequestUsage({
  inputTokens,
  outputTokens,
  cachedTokens,
  cacheWriteTokens = 0,
  modelConfig,
}: ComputeRequestUsageArgs): RequestUsageMetadata {
  const costUsd = computeTokenCostUsd({
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheWriteTokens,
    pricing: modelConfig.pricing,
  });

  const contextWindowSize = modelConfig.contextWindow ?? 0;
  const contextUsagePercent =
    contextWindowSize > 0 ? (inputTokens / contextWindowSize) * 100 : 0;

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    contextWindowSize,
    contextUsagePercent,
    model: modelConfig.id,
  };
}
