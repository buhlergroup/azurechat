/**
 * history-budget.ts
 *
 * Decides how much of a thread's persisted history goes into the next prompt.
 *
 * ## Why this module exists
 *
 * The chat path used to load history with `SELECT TOP 30 … ORDER BY createdAt
 * DESC`. Row 31 onwards did not exist as far as the model was concerned, and —
 * worse — every new turn pushed the oldest row out of the window. That moves
 * the start of the conversation, which moves the first byte of the prompt after
 * the developer message, which invalidates the prompt cache. Measured on
 * production traffic: the prompt shrank on 20 % of turn pairs and the cache hit
 * rate fell from 80 % to 30 % once a thread passed the cap. Threads longer than
 * ten turns account for 37 % of all written tokens, so the sliding window was
 * re-billing a large share of the traffic at the cache-write rate (1.25x).
 *
 * The fix has two halves. The loader now reads the WHOLE thread (see
 * `FindAllChatMessagesForCurrentUser`), and this module caps the result by
 * ESTIMATED TOKENS rather than by row count, with two properties the row cap
 * did not have:
 *
 *   1. **Turn-boundary cuts.** A cut only ever lands where a user message
 *      starts, so the surviving history is always a whole number of turns and
 *      never a dangling tool result with no call.
 *   2. **Hysteresis.** Nothing is trimmed until the estimate exceeds the
 *      budget, and when a trim does happen it goes all the way down to 60 % of
 *      the budget in one block. The prefix then stays byte-identical for the
 *      many turns it takes to climb back from 60 % to 100 %, instead of shifting
 *      on every single turn. This is the whole point: one big cache miss every
 *      few dozen turns beats a small one every turn.
 *
 * ## Contract
 *
 * Everything here is pure and deterministic: same input, same output, in any
 * process, on any pod, under any locale. The trim decision feeds a cache key,
 * so a non-deterministic estimator would defeat its own purpose.
 *
 * The estimator is deliberately a heuristic (see `estimateTextTokens`) and NOT
 * a real tokenizer. It is used to decide whether to drop a block of history,
 * not to bill anyone. A real BPE pass over an 80k-token thread on every turn
 * would cost more latency than the trim saves, and — because tokenizer
 * versions differ between models — it would not even be deterministic across
 * the model picker. What matters is that the same thread always yields the same
 * number.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Default ceiling on estimated history tokens, used when the model config
 * carries no `historyTokenBudget`.
 *
 * Not a context limit — the 5.6 family has a ~1M-token context window — but a
 * COST limit on the history that is re-sent every turn.
 *
 * 256k, i.e. summarisation only kicks in for genuinely long threads. Trimming
 * is lossy: the dropped block survives only as a ~1,500-token summary, and a
 * user who scrolls up can still see the turns the model can no longer quote.
 * That is a real cost, and it should be paid late rather than early. The
 * counter-pressure is that a cache entry is not forever: once it is evicted the
 * NEXT turn rewrites the whole prompt at 1.25x the uncached input rate, so the
 * bigger the carried history the bigger that periodic re-write.
 *
 * 256k is also where the long-context guard below happens to bite on the 5.6
 * family (272k threshold − 16k reserve = 256k), so on the default model the
 * configured budget and the guard agree, and no thread is carried into the 2x
 * long-context billing tier by history alone.
 */
export const DEFAULT_HISTORY_TOKEN_BUDGET = 256_000;

/**
 * Tokens held back from the model's own ceiling for everything in the prompt
 * that is NOT carried history: the developer/system message (static prompt,
 * persona, instruction blocks, tool definitions), the document hint, and the
 * user's current turn.
 *
 * 16k is generous for that set — a large persona plus a full toolset lands well
 * under it — and being generous is the right error: the guard exists to keep a
 * request off a billing cliff, so the reserve should absorb a prompt that grew
 * since the last measurement rather than track it exactly.
 *
 * Overridable via `HISTORY_LONG_CONTEXT_RESERVE`; see
 * `resolveHistoryLongContextReserve`.
 */
export const HISTORY_LONG_CONTEXT_RESERVE = 16_000;

/**
 * Fraction of a model's context window the history may occupy when the model
 * declares no `longContextThresholdTokens`, i.e. when there is no billing cliff
 * to stay under and the only thing to avoid is filling the window.
 *
 * 60 % leaves 40 % for the developer message, the current turn, the tool
 * results this turn will produce, and the reply (which on a reasoning model
 * includes the thinking tokens). A prompt that overflows the window is an
 * HTTP 400, not a bigger bill, so this branch is a correctness guard rather
 * than a cost one.
 */
export const CONTEXT_WINDOW_GUARD_RATIO = 0.6;

/**
 * Default fraction of the budget a trim lands on. The gap between 1.0
 * (trigger) and this value (target) IS the hysteresis: a thread has to grow
 * back through 40 % of the budget before the prefix moves again.
 *
 * Overridable per environment via `HISTORY_TRIM_TARGET_RATIO`; see
 * `resolveHistoryTrimTargetRatio`.
 */
export const HISTORY_TRIM_TARGET_RATIO = 0.6;

/**
 * Characters per token. Roughly right for English prose and for the JSON that
 * tool rows carry; it over-counts CJK and under-counts long base64 runs. Both
 * are acceptable — see the note on determinism above.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Flat cost charged for one image part. Real cost depends on the resolution
 * the provider tiles the image at, which we do not know at this point (the URL
 * may still be a `blob://` reference). 1,000 is in the right order of
 * magnitude for a typical screenshot and — critically — does not depend on the
 * URL string, so re-uploading the same image under a longer blob name cannot
 * change the estimate.
 */
export const IMAGE_TOKEN_ESTIMATE = 1_000;

/**
 * Turns that are never trimmed, counted from the newest end of the rows that
 * were loaded. The immediate context of the current question has to survive
 * regardless of budget, otherwise a single enormous turn could trim away the
 * question it is answering.
 *
 * NOTE on the "current turn": the chat path writes the user's new message to
 * Cosmos AFTER reading history, so the row list this module sees does NOT
 * contain the current turn. Keeping the last two loaded turns therefore keeps
 * the current turn plus the two before it.
 */
export const MIN_KEPT_TURNS = 2;

/**
 * Token allowance reserved for the replayed summary. Also the size the
 * summariser is instructed to stay under, so the two cannot drift apart.
 */
export const SUMMARY_TOKEN_RESERVE = 1_500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The subset of a persisted `ChatMessageModel` the budget cares about.
 * Structural on purpose: it keeps this module free of `server-only` imports
 * and lets tests build rows without a full Cosmos document.
 */
export interface BudgetMessage {
  id: string;
  role: string;
  content?: string;
  multiModalImage?: string;
  multiModalImages?: string[];
  reasoningContent?: string;
}

/** One conversational turn: a user message plus everything it produced. */
export interface HistoryTurn<T extends BudgetMessage = BudgetMessage> {
  /** Index into the input array of this turn's first row. */
  startIndex: number;
  /** Index into the input array of this turn's last row (inclusive). */
  endIndex: number;
  messages: T[];
  estimatedTokens: number;
  /**
   * True for a leading block of rows that precede the thread's first user
   * message (a stray system row, or tool rows orphaned by an old bug). It is
   * not really a turn, but it has to belong somewhere and it must be trimmable.
   */
  isPreamble: boolean;
}

export interface TrimPlanOptions {
  /** Estimated-token ceiling. Above this, and only above this, we trim. */
  budget?: number;
  /** Trim target as a fraction of `budget`. */
  targetRatio?: number;
  /** Newest turns that are never trimmed. */
  minKeptTurns?: number;
  /**
   * Tokens the summary already persisted for this thread occupies in today's
   * prompt. Counted towards the budget because it is really there.
   */
  existingSummaryTokens?: number;
  /**
   * Tokens to hold back for the summary that will REPLACE the existing one
   * after this trim. Zero when summarisation is disabled.
   */
  summaryReserveTokens?: number;
}

export interface TrimPlan<T extends BudgetMessage = BudgetMessage> {
  /** False when the history fitted; `kept` is then the input, untouched. */
  trimmed: boolean;
  /** Rows to send to the model, oldest-first. */
  kept: T[];
  /** Rows the summariser should stand in for, oldest-first. */
  dropped: T[];
  /** `existingSummaryTokens` + every row in the input. */
  estimatedTokensBefore: number;
  /** What the prompt's history section is expected to cost after the trim. */
  estimatedTokensAfter: number;
  budget: number;
  /** The absolute token figure `targetRatio` resolved to. */
  target: number;
  droppedTurnCount: number;
  keptTurnCount: number;
  /**
   * Cosmos id of the NEWEST dropped row — the watermark the summary covers
   * through. Undefined when nothing was dropped.
   */
  coversThroughMessageId?: string;
  /**
   * Set when the history still exceeds `target` after dropping every turn it
   * was allowed to drop, i.e. the surviving turns alone are over target. The
   * caller should log it; there is no correct automatic response beyond
   * trusting the model's context window, since the alternative is deleting the
   * question being answered.
   */
  targetUnreachable: boolean;
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/**
 * Deterministic token estimate for a text blob: `ceil(length / 4)`.
 *
 * `ceil` rather than `round` so that any non-empty string costs at least one
 * token — a row can never be free, which keeps the accumulation strictly
 * monotonic in the number of rows.
 */
export function estimateTextTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimated tokens for one persisted row.
 *
 * `content` covers prose AND the JSON blob on `role: "tool"` rows, which is
 * where tool arguments, tool results and any text extracted from an attached
 * document actually live once persisted — so those are counted by counting
 * `content`, with no special-casing needed.
 *
 * Images are the one thing that must NOT be counted by string length: a
 * persisted image is either a `blob://` reference (a few dozen characters for
 * something that costs ~1,000 tokens) or an inline `data:` URL (hundreds of
 * kilobytes of base64 for the same ~1,000 tokens). Length is meaningless in
 * both directions, so each image part costs a flat `IMAGE_TOKEN_ESTIMATE`.
 *
 * Deleted rows cost nothing: they are dropped before the model sees them.
 */
export function estimateMessageTokens(message: BudgetMessage): number {
  let tokens = estimateTextTokens(message.content);
  tokens += estimateTextTokens(message.reasoningContent);

  const images =
    message.multiModalImages ??
    (message.multiModalImage ? [message.multiModalImage] : []);
  tokens += images.length * IMAGE_TOKEN_ESTIMATE;

  return tokens;
}

/** Estimated tokens for a whole run of rows. */
export function estimateHistoryTokens(
  messages: readonly BudgetMessage[],
): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total;
}

// ---------------------------------------------------------------------------
// Turn segmentation
// ---------------------------------------------------------------------------

/**
 * Split oldest-first rows into turns. A turn opens at every `user` row and
 * runs up to (but not including) the next one, so it carries that user
 * message, the assistant reply, and every `tool` / `reasoning` row generated
 * in between.
 *
 * Cutting on user rows rather than on assistant rows is what makes a trim safe
 * to hand to `convertToModelMessages`: a tool result is never separated from
 * the assistant message that called it, because both sit inside the same turn.
 */
export function splitIntoTurns<T extends BudgetMessage>(
  messages: readonly T[],
): HistoryTurn<T>[] {
  const turns: HistoryTurn<T>[] = [];
  let current: HistoryTurn<T> | undefined;

  messages.forEach((message, index) => {
    const startsNewTurn = message.role === "user";

    if (startsNewTurn || current === undefined) {
      current = {
        startIndex: index,
        endIndex: index,
        messages: [],
        estimatedTokens: 0,
        // Only a block that opens without a user row is a preamble.
        isPreamble: !startsNewTurn,
      };
      turns.push(current);
    }

    current.messages.push(message);
    current.endIndex = index;
    current.estimatedTokens += estimateMessageTokens(message);
  });

  return turns;
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

/**
 * Drop the rows a previous trim already accounted for.
 *
 * ## Why a watermark is required, and not merely an optimisation
 *
 * A trim does not delete anything — the rows stay in Cosmos so the transcript
 * still renders in full. So the next turn re-reads them, and if the budget were
 * the only input the plan would simply trim again, one turn further along. The
 * cut would advance by one turn on every turn: a sliding window with a bigger
 * number in it, and the same cache behaviour as the `TOP 30` it replaced.
 *
 * The watermark is what makes a trim STICK. It is the Cosmos id of the newest
 * row the last trim removed, persisted on the thread's summary row. Rows up to
 * and including it are gone from the prompt for good, so the retained span
 * starts at a fixed point and the prefix stays byte-identical until the budget
 * is exceeded again — which takes the many turns it needs to grow from 60 %
 * back to 100 %.
 *
 * ## Fail-open
 *
 * A watermark id that is not in the rows means the row it named is gone: the
 * user rewound the thread, or deleted messages. Rather than guess, this returns
 * everything and lets the budget re-derive a cut from scratch. Sending too much
 * history costs tokens; guessing wrong could blank a thread the user can still
 * see on screen.
 */
export function applyHistoryWatermark<T extends BudgetMessage>(
  messages: readonly T[],
  coversThroughMessageId: string | undefined,
): { retained: T[]; alreadyCompacted: T[]; watermarkFound: boolean } {
  if (!coversThroughMessageId) {
    return { retained: [...messages], alreadyCompacted: [], watermarkFound: false };
  }

  const index = messages.findIndex((m) => m.id === coversThroughMessageId);
  if (index === -1) {
    return { retained: [...messages], alreadyCompacted: [], watermarkFound: false };
  }

  return {
    retained: messages.slice(index + 1),
    alreadyCompacted: messages.slice(0, index + 1),
    watermarkFound: true,
  };
}

// ---------------------------------------------------------------------------
// Budget resolution
// ---------------------------------------------------------------------------

/**
 * Reserve for the non-history part of the prompt, from
 * `HISTORY_LONG_CONTEXT_RESERVE`, else `HISTORY_LONG_CONTEXT_RESERVE`'s
 * default. Zero is honoured (an operator may explicitly want the whole
 * threshold available); anything unparseable or negative is not.
 */
export function resolveHistoryLongContextReserve(input?: {
  envReserve?: string;
}): number {
  const raw = input?.envReserve;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return HISTORY_LONG_CONTEXT_RESERVE;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  return HISTORY_LONG_CONTEXT_RESERVE;
}

/** Where the base budget came from. */
export type HistoryBudgetSource = "env" | "model" | "default";

/** Which model ceiling produced the guard, if any. */
export type HistoryGuardSource = "longContextThreshold" | "contextWindow" | "none";

export interface HistoryBudgetDecision {
  /** What to hand `planHistoryTrim` — the base budget after the guard. */
  budget: number;
  /** The configured budget, before the guard. */
  baseBudget: number;
  baseSource: HistoryBudgetSource;
  /** The model-derived ceiling; undefined when the model declares neither. */
  guard?: number;
  guardSource: HistoryGuardSource;
  /** Tokens held back for the developer message and the current turn. */
  reserve: number;
  /** True when the guard, not the configured budget, decided. */
  cappedByGuard: boolean;
}

/**
 * Resolve the effective history budget: the CONFIGURED budget, bounded by what
 * the model that will answer can afford to be handed.
 *
 * ## Base budget
 *
 * Precedence: `HISTORY_TOKEN_BUDGET` env override > the model config's
 * `historyTokenBudget` > the module default. The env override wins so the
 * budget can be dialled down in one place during an incident without a deploy.
 * A value that is absent, unparseable or non-positive is ignored rather than
 * honoured — a typo in an env var must not silently reduce every thread to no
 * history at all.
 *
 * ## The guard, and why the configured number is not the last word
 *
 * A budget large enough to be worth configuring is also large enough to walk a
 * request over a per-model boundary, and the boundaries are not the same shape:
 *
 *   - `longContextThresholdTokens` — a BILLING cliff. Azure bills GPT-5.6 input
 *     above 272k tokens at a separate "long context" tier at 2x the normal rate
 *     (it shows up as the `LongCo*` meters). Nothing fails; the invoice just
 *     doubles for every token of that request, cached tokens included. Carrying
 *     history over the line is the worst way to cross it, because history is
 *     re-sent every single turn. Guard = threshold − reserve.
 *   - `contextWindow` — a CORRECTNESS limit. No cliff to price, just a wall:
 *     overflow it and the provider answers HTTP 400. Guard =
 *     `CONTEXT_WINDOW_GUARD_RATIO` (60 %) of the window, which leaves the other
 *     40 % for the developer message, the current turn, tool results and the
 *     reply.
 *
 * The threshold wins when both are declared: it is always the lower of the two
 * and it is the one with a price attached. With neither declared there is
 * nothing to bound against, so the configured budget stands.
 *
 * A guard that comes out at or below zero (a reserve larger than the model's
 * own threshold — i.e. a misconfiguration) is discarded rather than applied:
 * the alternative is a budget of zero, which would carry no history at all on
 * every thread of that model.
 */
export function resolveHistoryBudget(input?: {
  modelBudget?: number;
  envBudget?: string;
  longContextThresholdTokens?: number;
  contextWindow?: number;
  envReserve?: string;
}): HistoryBudgetDecision {
  let baseBudget = DEFAULT_HISTORY_TOKEN_BUDGET;
  let baseSource: HistoryBudgetSource = "default";

  const parsedEnv = Number(input?.envBudget);
  const modelBudget = input?.modelBudget;
  if (Number.isFinite(parsedEnv) && parsedEnv > 0) {
    baseBudget = Math.floor(parsedEnv);
    baseSource = "env";
  } else if (
    typeof modelBudget === "number" &&
    Number.isFinite(modelBudget) &&
    modelBudget > 0
  ) {
    baseBudget = Math.floor(modelBudget);
    baseSource = "model";
  }

  const reserve = resolveHistoryLongContextReserve({
    envReserve: input?.envReserve,
  });

  let guard: number | undefined;
  let guardSource: HistoryGuardSource = "none";
  const threshold = input?.longContextThresholdTokens;
  const contextWindow = input?.contextWindow;
  if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0) {
    guard = Math.floor(threshold) - reserve;
    guardSource = "longContextThreshold";
  } else if (
    typeof contextWindow === "number" &&
    Number.isFinite(contextWindow) &&
    contextWindow > 0
  ) {
    guard = Math.floor(contextWindow * CONTEXT_WINDOW_GUARD_RATIO);
    guardSource = "contextWindow";
  }

  if (guard !== undefined && guard <= 0) {
    guard = undefined;
    guardSource = "none";
  }

  const budget = guard === undefined ? baseBudget : Math.min(baseBudget, guard);

  return {
    budget,
    baseBudget,
    baseSource,
    guard,
    guardSource,
    reserve,
    cappedByGuard: guard !== undefined && guard < baseBudget,
  };
}

/**
 * The effective budget only. Thin wrapper over `resolveHistoryBudget` for
 * callers that do not need to log which value won.
 */
export function resolveHistoryTokenBudget(input?: {
  modelBudget?: number;
  envBudget?: string;
  longContextThresholdTokens?: number;
  contextWindow?: number;
  envReserve?: string;
}): number {
  return resolveHistoryBudget(input).budget;
}

/**
 * Resolve the trim target as a fraction of the budget. `HISTORY_TRIM_TARGET_RATIO`
 * overrides the module default.
 *
 * Only a value strictly between 0 and 1 is honoured. At 1.0 there would be no
 * hysteresis left — the trim would land exactly on the trigger, so the next
 * turn would trim again and the prefix would move every turn, which is the
 * behaviour this module exists to remove. At 0 the trim would drop everything
 * it is allowed to drop, throwing away context for no cache benefit. Both are
 * treated as a misconfiguration and ignored.
 */
export function resolveHistoryTrimTargetRatio(input?: {
  envRatio?: string;
}): number {
  const parsed = Number(input?.envRatio);
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) return parsed;
  return HISTORY_TRIM_TARGET_RATIO;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Work out which turns to drop, if any.
 *
 * The shape of the decision:
 *
 *   over budget?           estimatedTokensBefore > budget
 *   how far to cut?        down to `target` (= budget x targetRatio), minus
 *                          whatever the replacement summary will occupy
 *   where can we cut?      only at a turn boundary, and never into the newest
 *                          `minKeptTurns` turns
 *
 * Turns are dropped oldest-first, stopping as soon as the remainder is at or
 * under target, so exactly one contiguous block leaves at the front.
 */
export function planHistoryTrim<T extends BudgetMessage>(
  messages: readonly T[],
  options: TrimPlanOptions = {},
): TrimPlan<T> {
  const budget = options.budget ?? DEFAULT_HISTORY_TOKEN_BUDGET;
  const targetRatio = options.targetRatio ?? HISTORY_TRIM_TARGET_RATIO;
  const minKeptTurns = options.minKeptTurns ?? MIN_KEPT_TURNS;
  const existingSummaryTokens = options.existingSummaryTokens ?? 0;
  const summaryReserveTokens = options.summaryReserveTokens ?? 0;

  const historyTokens = estimateHistoryTokens(messages);
  const estimatedTokensBefore = historyTokens + existingSummaryTokens;
  const target = Math.floor(budget * targetRatio);

  const turns = splitIntoTurns(messages);

  if (estimatedTokensBefore <= budget) {
    return {
      trimmed: false,
      kept: [...messages],
      dropped: [],
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
      budget,
      target,
      droppedTurnCount: 0,
      keptTurnCount: turns.length,
      targetUnreachable: false,
    };
  }

  // Room the surviving turns get, once the replacement summary has taken its
  // cut of the target.
  const historyTarget = Math.max(0, target - summaryReserveTokens);
  const maxDroppableTurns = Math.max(0, turns.length - minKeptTurns);

  let droppedTurnCount = 0;
  let remainingHistoryTokens = historyTokens;
  while (
    droppedTurnCount < maxDroppableTurns &&
    remainingHistoryTokens > historyTarget
  ) {
    remainingHistoryTokens -= turns[droppedTurnCount].estimatedTokens;
    droppedTurnCount++;
  }

  if (droppedTurnCount === 0) {
    // Over budget, but every turn is protected by minKeptTurns. Report it as
    // an un-trimmed plan so the caller does not spend a summariser call on an
    // empty block.
    return {
      trimmed: false,
      kept: [...messages],
      dropped: [],
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
      budget,
      target,
      droppedTurnCount: 0,
      keptTurnCount: turns.length,
      targetUnreachable: true,
    };
  }

  const cutIndex = turns[droppedTurnCount].startIndex;
  const dropped = messages.slice(0, cutIndex);
  const kept = messages.slice(cutIndex);

  return {
    trimmed: true,
    kept: [...kept],
    dropped: [...dropped],
    estimatedTokensBefore,
    estimatedTokensAfter: remainingHistoryTokens + summaryReserveTokens,
    budget,
    target,
    droppedTurnCount,
    keptTurnCount: turns.length - droppedTurnCount,
    coversThroughMessageId: dropped[dropped.length - 1]?.id,
    targetUnreachable: remainingHistoryTokens > historyTarget,
  };
}
