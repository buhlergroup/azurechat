// Pure helpers for assembling the cache-relevant parts of an Azure OpenAI
// Responses request. Kept side-effect free so the byte-for-byte stability of
// the prompt prefix can be locked down by tests in prompt-builder.test.ts.

import type { ModelMessage, SystemModelMessage } from "ai";

export interface PromptBuilderInputs {
  staticSystemPrompt: string;
  personaMessage: string;
  /** Optional document hint block. Empty string when no documents are attached. */
  documentHint?: string;
  /**
   * Static instruction blocks the caller wants appended AFTER the persona but
   * BEFORE the per-thread document hint (see the ordering note on
   * `buildSystemMessage`). Callers must only pass process-constant text here —
   * anything thread-scoped belongs in `documentHint`.
   */
  trailingStaticBlock?: string;
}

/**
 * Build the system message body. Output is a pure function of its inputs —
 * identical inputs MUST yield byte-for-byte identical output across processes,
 * pods, and locales. The Azure OpenAI prompt cache keys on the first 1024 tokens
 * of input, so any drift here translates directly into cache misses.
 *
 * The current date is intentionally NOT included here: injecting `today` would
 * invalidate the prompt cache at every UTC midnight rollover and prevent any
 * cross-day reuse. Time-sensitive answers should rely on tool calls instead.
 *
 * ORDERING (load-bearing): the assembled message is
 *
 *   staticSystemPrompt -> personaMessage -> trailingStaticBlock -> documentHint
 *
 * Both per-thread segments must sit as far right as possible. A prompt cache
 * can only reuse the bytes to the LEFT of the first byte that changed, so a
 * segment that moves invalidates every segment after it. `documentHint` is the
 * most volatile input we have — it appears, disappears and changes wording the
 * moment a user attaches or removes a document — so it goes LAST. It used to
 * sit between the static prompt and the persona, which meant attaching a single
 * document rewrote the persona and every instruction block after it, i.e. the
 * entire prefix, at the cache-write rate.
 *
 * `personaMessage` is per-thread too, but it is fixed for the life of a thread,
 * so it is stable exactly where a cacheable prefix needs it to be.
 */
export function buildSystemMessage(inputs: PromptBuilderInputs): string {
  const {
    staticSystemPrompt,
    personaMessage,
    documentHint = "",
    trailingStaticBlock = "",
  } = inputs;
  return `${staticSystemPrompt}\n\n${personaMessage}${trailingStaticBlock}${documentHint}`;
}

/**
 * Sort function-typed tools by name. The Responses API treats the tools array
 * as part of the request body that participates in the cache key, so its order
 * must be deterministic regardless of which conditional branches/extensions
 * registered each tool.
 *
 * Returns a new array; does not mutate input.
 */
export function sortFunctionTools<T extends { name?: string }>(tools: readonly T[]): T[] {
  return [...tools].sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
}

/**
 * One Anthropic `cache_control` breakpoint (default 5-minute "ephemeral" TTL —
 * matches the cadence of an interactive chat turn). @ai-sdk/anthropic reads it
 * from `providerOptions.anthropic.cacheControl`. Returns a fresh object each
 * call so breakpoints on different messages never alias.
 */
function anthropicCacheControl(): { anthropic: { cacheControl: { type: "ephemeral" } } } {
  return { anthropic: { cacheControl: { type: "ephemeral" } } };
}

/**
 * Turn the shared streamText inputs into a cache-optimised pair for Claude
 * models served via the Azure /anthropic Messages API.
 *
 * Unlike OpenAI (whose Azure seam gets automatic caching from `promptCacheKey`),
 * Anthropic caches only the prefixes you mark with explicit `cache_control`
 * breakpoints. We set two — well under Anthropic's limit of 4:
 *
 *   1. **System prompt** — passed as a `SystemModelMessage` rather than a bare
 *      string so it can carry `providerOptions`. In Anthropic's render order
 *      (tools → system → messages) a breakpoint on the system block caches the
 *      tool definitions AND the system prompt as a single reusable prefix.
 *   2. **Latest turn** — a message-level breakpoint on the last message. The AI
 *      SDK applies it to that message's final content part, so each turn writes
 *      a cache entry covering the whole conversation-so-far; the next turn
 *      replays it as a cache read instead of re-billing the history in full.
 *
 * Returns the `{ system, messages }` to hand to `streamText`. The system prompt
 * moves out of the top-level string and into a `SystemModelMessage`, so callers
 * must spread BOTH fields (don't keep passing the original `system` string).
 *
 * Caching is a prefix match: it only pays off while the prefix stays
 * byte-stable across turns (see `buildSystemMessage`'s note on excluding the
 * date). Anthropic silently skips any breakpoint whose prefix is below the
 * per-model minimum (~1–4K tokens), so this is a safe no-op for short prompts
 * and a win once the tools+system prefix is large enough to cache.
 */
export function withAnthropicPromptCache(
  system: string,
  messages: readonly ModelMessage[],
): { system: SystemModelMessage; messages: ModelMessage[] } {
  const cachedSystem: SystemModelMessage = {
    role: "system",
    content: system,
    providerOptions: anthropicCacheControl(),
  };

  const out = [...messages];
  const lastIndex = out.length - 1;
  if (lastIndex >= 0) {
    const last = out[lastIndex];
    // Merge so we don't clobber any pre-existing providerOptions on the turn.
    out[lastIndex] = {
      ...last,
      providerOptions: {
        ...last.providerOptions,
        anthropic: {
          ...last.providerOptions?.anthropic,
          ...anthropicCacheControl().anthropic,
        },
      },
    } as ModelMessage;
  }

  return { system: cachedSystem, messages: out };
}
