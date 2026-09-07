import "server-only";

/**
 * Why there is no `"use server"` here
 * -----------------------------------
 * `"use server"` marks a module as a SERVER ACTION surface: Next turns every
 * export into an RPC endpoint a client component may call, and therefore
 * rejects any export that is not an async function. This module is reached
 * only from other server modules, never from a client component, so it wants
 * the opposite guarantee — "never bundle me for the browser" — which is what
 * `import "server-only"` gives. That is the convention the neighbouring
 * non-action server modules follow (`persist-assistant.ts`, `rate-limit.ts`,
 * `stream-publisher.ts`, ...). Do not add the directive back: it is not needed
 * for a server module, and it breaks `next build` the moment this file gains a
 * sync export.
 */

/**
 * history-summary-service.ts
 *
 * Impure half of history compaction: the Cosmos read/write of the thread's
 * compaction row and the model call that fills in its summary text.
 * Everything prompt-shaped lives in `history-summary.ts` and is unit-tested
 * there.
 *
 * ## Two jobs, one row
 *
 * The row this module manages carries two things:
 *
 *   - `coversThroughMessageId` — the WATERMARK. Load-bearing regardless of any
 *     feature flag: it is what makes a trim stick instead of sliding forward a
 *     turn at a time (see `applyHistoryWatermark`). The row is therefore
 *     written on every trim, summarisation or not.
 *   - `content` — the summary of everything up to the watermark. Empty when
 *     summarisation is off or when the summariser failed. An empty summary
 *     replays nothing; the watermark still holds.
 *
 * ## Feature gating
 *
 * Summary TEXT is produced only when `HISTORY_SUMMARY_ENABLED=true`. With the
 * flag off, an over-budget thread is still trimmed and still watermarked — it
 * just loses the dropped block rather than getting a précis of it. That
 * ordering is deliberate: the cost and cache benefit of the trim must not
 * depend on a second model call working.
 *
 * ## Failure policy
 *
 * Every failure path degrades and never throws into the chat turn. A
 * summariser that is down, rate-limited or misconfigured must cost the user a
 * bit of old context, not their answer.
 */

import { SqlQuerySpec } from "@azure/cosmos";
import { userHashedId } from "@/features/auth-page/helpers";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { OpenAIMiniInstance, OpenAIV1Instance } from "@/features/common/services/openai";
import { logError, logInfo, logWarn } from "@/features/common/services/logger";
import { estimateTextTokens, type BudgetMessage } from "./history-budget";
import {
  HISTORY_SUMMARY_ATTRIBUTE,
  HISTORY_SUMMARY_SYSTEM_PROMPT,
  buildHistorySummaryPrompt,
  buildHistorySummaryRow,
  type ChatHistorySummaryModel,
} from "./history-summary";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Feature flag. Strict equality with "true" — anything else is off. */
export function isHistorySummaryEnabled(): boolean {
  return process.env.HISTORY_SUMMARY_ENABLED === "true";
}

/**
 * Deployment used for summarising.
 *
 * Order: `HISTORY_SUMMARY_DEPLOYMENT_NAME` if set, otherwise the cheapest 5.6
 * model (luna), otherwise the deployment already used for thread titles.
 *
 * Luna is the right default. Summarising a 50k-token block is the kind of
 * mechanical compression the cheapest model in the family does about as well
 * as the flagship, at a fraction of the input price — and running it on the
 * flagship would eat much of what the trim just saved.
 */
export function resolveHistorySummaryDeployment(): string | undefined {
  return (
    process.env.HISTORY_SUMMARY_DEPLOYMENT_NAME ||
    process.env.AZURE_OPENAI_API_GPT56_LUNA_DEPLOYMENT_NAME ||
    process.env.AZURE_OPENAI_API_MINI_DEPLOYMENT_NAME
  );
}

/**
 * Hard ceiling on the transcript handed to the summariser, in characters.
 *
 * A trim can drop a very large block — the first trim on a thread that grew
 * past the budget in one enormous tool result, say. Without a cap the
 * summariser call could cost more than the turn it is meant to make cheaper.
 * 400k characters is ~100k estimated tokens, which fits every candidate
 * summariser with room to spare. Over the cap the NEWEST characters are kept:
 * the tail of the dropped block is the part still bearing on what follows it.
 */
const MAX_SUMMARY_INPUT_CHARS = 400_000;

/**
 * Ceiling on what the summariser may EMIT.
 *
 * The prompt asks it to stay under SUMMARY_TOKEN_RESERVE (1,500) tokens, but
 * an instruction is not a limit — and this output is replayed at the front of
 * every later prompt in the thread, so an oversized summary is not a one-off
 * cost, it is rent. 2,000 leaves headroom above the instruction without
 * letting a runaway summary become a permanent line item.
 */
const SUMMARY_MAX_OUTPUT_TOKENS = 2_000;

/**
 * How long the summariser gets before the trim gives up on it.
 *
 * This call sits ON THE REQUEST PATH: it runs inside loadThreadContext, before
 * the stream starts, so every millisecond it takes is a millisecond the user
 * spends looking at nothing. It only happens on a trimming turn — once every
 * few dozen turns — but a throttled or hanging deployment would otherwise
 * stall that turn indefinitely, with no ceiling at all.
 *
 * A timeout is not a degradation here: the fallback is the plain trim, which
 * is what the feature flag being off does anyway. The watermark is still
 * written, so the trim still sticks; only the summary text is lost.
 *
 * 20 seconds is generous for ~2,000 output tokens on the cheapest model in
 * the family, and still well inside what a user will wait for a first token.
 */
export const DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS = 20_000;

/**
 * Resolve the summariser timeout. `HISTORY_SUMMARY_TIMEOUT_MS` overrides the
 * default; a value that is absent, unparseable or non-positive is ignored
 * rather than honoured, because a typo must not turn into "give up
 * immediately" (or, worse, "wait forever").
 */
export function resolveHistorySummaryTimeoutMs(
  raw: string | undefined = process.env.HISTORY_SUMMARY_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS;
}

/** Thrown when the summariser outruns its budget. Caught by the caller. */
export class HistorySummaryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`history summariser exceeded ${timeoutMs}ms`);
    this.name = "HistorySummaryTimeoutError";
  }
}

/**
 * Run `work` with a deadline. The AbortSignal is handed to the work so a real
 * HTTP call is CANCELLED rather than left running to completion in the
 * background — abandoning it would keep spending on a result nobody reads.
 *
 * The timer is always cleared, so a fast success cannot leave a pending timer
 * holding the process (or a test runner) open.
 */
async function withDeadline<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HistorySummaryTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Cosmos: read
// ---------------------------------------------------------------------------

/**
 * Read the thread's compaction row, or null when there is none.
 *
 * Returns null rather than an error envelope on failure. A missing row and an
 * unreadable row lead to the same behaviour — treat the thread as
 * un-compacted — so a caller has nothing useful to do with the distinction.
 * The cost of the false negative is one extra trim, not a wrong answer.
 */
export async function FindChatHistorySummary(
  threadId: string,
): Promise<ChatHistorySummaryModel | null> {
  try {
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT * FROM root r WHERE r.type=@type AND r.threadId=@threadId AND r.userId=@userId AND r.isDeleted=@isDeleted",
      parameters: [
        { name: "@type", value: HISTORY_SUMMARY_ATTRIBUTE },
        { name: "@threadId", value: threadId },
        { name: "@userId", value: await userHashedId() },
        { name: "@isDeleted", value: false },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<ChatHistorySummaryModel>(querySpec)
      .fetchAll();

    return resources[0] ?? null;
  } catch (e) {
    logWarn("history-summary: failed to read compaction row", {
      threadId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cosmos: write
// ---------------------------------------------------------------------------

/** Upsert the thread's single compaction row. Returns false on failure. */
export async function UpsertChatHistorySummary(
  row: ChatHistorySummaryModel,
): Promise<boolean> {
  try {
    await HistoryContainer().items.upsert<ChatHistorySummaryModel>(row);
    return true;
  } catch (e) {
    logError("history-summary: failed to persist compaction row", {
      threadId: row.threadId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * Soft-delete the thread's compaction row.
 *
 * Called when a thread's messages are soft-deleted — a "delete from here"
 * rewind, or the whole thread going away. A summary that outlives the rows it
 * describes is worse than no summary: the model would keep citing content the
 * user deliberately removed, with nothing in the visible transcript to explain
 * where it came from. Clearing the watermark at the same time lets the budget
 * re-derive a cut from whatever is left.
 */
export async function SoftDeleteChatHistorySummary(
  threadId: string,
): Promise<void> {
  const existing = await FindChatHistorySummary(threadId);
  if (!existing) return;
  await UpsertChatHistorySummary({ ...existing, isDeleted: true });
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

/**
 * Function that turns a prompt pair into summary text. Injected by
 * `recordHistoryCompaction` so unit tests never reach a model; the default is
 * `callSummariserModel`.
 */
export type SummariserFn = (input: {
  systemPrompt: string;
  userPrompt: string;
  deployment: string;
  /**
   * Trips when the summariser has outrun its deadline. Forwarded to the HTTP
   * call so it is cancelled rather than abandoned. A fake in a test may
   * ignore it — the deadline is enforced by the caller either way.
   */
  signal?: AbortSignal;
}) => Promise<string>;

/**
 * Default summariser: one non-streaming chat completion.
 *
 * Chat Completions rather than the Responses API on purpose. There is no
 * thread state, no tool and no reasoning to carry here — one prompt in, one
 * block of text out — and Chat Completions is the surface both candidate
 * deployments (luna, and the mini already used for thread titles) are
 * guaranteed to expose.
 */
async function callSummariserModel(input: {
  systemPrompt: string;
  userPrompt: string;
  deployment: string;
  signal?: AbortSignal;
}): Promise<string> {
  // The V1 client serves the 5.6 deployments; the mini client is the one wired
  // to the titles deployment. Pick by which env var the deployment name came
  // from, so a HISTORY_SUMMARY_DEPLOYMENT_NAME pointing at either still works.
  const isMiniDeployment =
    input.deployment === process.env.AZURE_OPENAI_API_MINI_DEPLOYMENT_NAME;
  const client = isMiniDeployment ? OpenAIMiniInstance() : OpenAIV1Instance();

  const completion = await client.chat.completions.create(
    {
      model: input.deployment,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      // The prompt ASKS for brevity; this enforces it. The summary is
      // replayed in every later prompt of the thread, so its size is rent
      // rather than a one-off. `max_completion_tokens`, not `max_tokens`:
      // the 5.x generation this runs on rejects the older field.
      max_completion_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
    },
    { signal: input.signal },
  );

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface RecordHistoryCompactionInput {
  threadId: string;
  /** Hashed user id — also the history container's partition key. */
  userId: string;
  /** The block the trim removed, oldest-first. */
  droppedMessages: readonly BudgetMessage[];
  /** Cosmos id of the newest dropped row: the new watermark. */
  coversThroughMessageId: string;
  /** The row being replaced, if the thread had already been compacted. */
  previous?: ChatHistorySummaryModel | null;
  /** Test seam. Defaults to the real model call. */
  summarise?: SummariserFn;
}

/**
 * Record a trim: advance the watermark and, when enabled, summarise the block
 * that was dropped.
 *
 * Called ONCE per trim, which is once every few dozen turns rather than once
 * per turn — that ratio is the point of the hysteresis in `planHistoryTrim`.
 *
 * The previous summary is folded into the new one rather than being kept
 * alongside it, so a thread never accumulates a chain of summaries and one row
 * always accounts for the entire compacted span.
 *
 * Returns the stored row, or null if even the watermark could not be written
 * (in which case the caller has still trimmed this turn, and will trim again
 * next turn).
 */
export async function recordHistoryCompaction(
  input: RecordHistoryCompactionInput,
): Promise<ChatHistorySummaryModel | null> {
  const previousContent = input.previous?.content?.trim() || undefined;
  const previousCount = input.previous?.coversMessageCount ?? 0;

  let content = "";
  let model = "";

  if (isHistorySummaryEnabled() && input.droppedMessages.length > 0) {
    const summarised = await summariseDroppedBlock({
      threadId: input.threadId,
      droppedMessages: input.droppedMessages,
      previousSummary: previousContent,
      summarise: input.summarise,
    });
    if (summarised) {
      content = summarised.content;
      model = summarised.model;
    } else if (previousContent) {
      // Summarisation failed but an earlier summary exists. It still correctly
      // describes everything BEFORE this block, so carry it forward verbatim
      // rather than discarding context we already paid for. The newly dropped
      // block is the only thing lost.
      content = previousContent;
      model = input.previous?.model ?? "";
    }
  } else if (previousContent) {
    // Summarisation disabled, but this thread was compacted while it was on.
    // Keep the text; only the watermark moves.
    content = previousContent;
    model = input.previous?.model ?? "";
  }

  const row = buildHistorySummaryRow({
    threadId: input.threadId,
    userId: input.userId,
    content,
    coversThroughMessageId: input.coversThroughMessageId,
    coversMessageCount: previousCount + input.droppedMessages.length,
    model,
    estimatedTokens: estimateTextTokens(content),
  });

  const persisted = await UpsertChatHistorySummary(row);
  if (!persisted) return null;

  logInfo("history-summary: recorded history compaction", {
    threadId: input.threadId,
    coversThroughMessageId: row.coversThroughMessageId,
    coversMessageCount: row.coversMessageCount,
    droppedThisTrim: input.droppedMessages.length,
    summarised: content.length > 0,
    model: row.model,
    estimatedTokens: row.estimatedTokens,
  });

  return row;
}

/**
 * Run the summariser over one dropped block. Returns null on any failure — a
 * missing deployment, a throwing call, a TIMEOUT, or an empty answer — each
 * logged as a warning so a silently degraded thread is still visible in the
 * logs.
 *
 * Every one of those falls back to the same place: the plain trim. The
 * watermark is still written by the caller, so the trim still sticks and the
 * prompt is still cheap; what is lost is the summary text, which is exactly
 * what the feature flag being off costs anyway. That is why this returns null
 * rather than throwing — a summariser problem must never fail the turn.
 */
async function summariseDroppedBlock(input: {
  threadId: string;
  droppedMessages: readonly BudgetMessage[];
  previousSummary?: string;
  summarise?: SummariserFn;
}): Promise<{ content: string; model: string } | null> {
  const deployment = resolveHistorySummaryDeployment();
  if (!deployment) {
    logWarn(
      "history-summary: enabled but no deployment resolved; falling back to plain trimming",
      { threadId: input.threadId },
    );
    return null;
  }

  const fullPrompt = buildHistorySummaryPrompt({
    messages: input.droppedMessages,
    previousSummary: input.previousSummary,
  });
  const userPrompt =
    fullPrompt.length > MAX_SUMMARY_INPUT_CHARS
      ? fullPrompt.slice(fullPrompt.length - MAX_SUMMARY_INPUT_CHARS)
      : fullPrompt;

  const summarise = input.summarise ?? callSummariserModel;
  const timeoutMs = resolveHistorySummaryTimeoutMs();

  let raw: string;
  try {
    // Bounded even for an injected fake: the deadline belongs to the request
    // path, not to whichever summariser happens to be wired in.
    raw = await withDeadline(timeoutMs, (signal) =>
      summarise({
        systemPrompt: HISTORY_SUMMARY_SYSTEM_PROMPT,
        userPrompt,
        deployment,
        signal,
      }),
    );
  } catch (e) {
    const timedOut = e instanceof HistorySummaryTimeoutError;
    logWarn(
      timedOut
        ? "history-summary: summariser timed out; falling back to plain trimming"
        : "history-summary: summariser call failed; falling back to plain trimming",
      {
        threadId: input.threadId,
        deployment,
        droppedMessageCount: input.droppedMessages.length,
        timedOut,
        timeoutMs,
        error: e instanceof Error ? e.message : String(e),
      },
    );
    return null;
  }

  const content = raw?.trim() ?? "";
  if (content.length === 0) {
    logWarn(
      "history-summary: summariser returned nothing; falling back to plain trimming",
      { threadId: input.threadId, deployment },
    );
    return null;
  }

  return { content, model: deployment };
}
