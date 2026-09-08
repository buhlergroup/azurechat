/**
 * compaction-part.ts
 *
 * The wire contract for the `data-compaction` UI message part, plus the copy
 * derived from it. Pure and client-safe on purpose: the route writes these
 * parts into the UI message stream, the transcript renders them, and the
 * thread loader synthesises one from the persisted `CHAT_HISTORY_SUMMARY` row
 * so the marker survives a reload. All three need the same shape and the same
 * words.
 *
 * ## Why the user is told at all
 *
 * A trim is the one thing the chat does that quietly makes the model know less
 * than the transcript on screen. The rows stay in Cosmos and keep rendering,
 * so without a marker the user has no way to tell that the model can no longer
 * quote the turns they can still scroll to. The divider is where the
 * conversation the model sees actually begins.
 *
 * ## Reconciliation
 *
 * Every part carries the SAME `id` (`COMPACTION_PART_ID`) for a given turn.
 * The AI SDK reconciles data parts by `(type, id)` — a second write with the
 * same id replaces the first in place rather than appending — which is what
 * lets a "running" notice become a "done" notice without leaving two dividers
 * in the transcript.
 */

/** The part type. `data-` prefixed, as the AI SDK requires for custom parts. */
export const COMPACTION_DATA_PART_TYPE = "data-compaction" as const;

/**
 * Stable part id. One compaction per turn, so one id is enough, and reusing it
 * is what makes the second write an update instead of a second divider.
 */
export const COMPACTION_PART_ID = "compaction" as const;

/** Written when a trim has been decided and the summariser is still running. */
export interface CompactionRunningData {
  status: "running";
  /** Turns the plan will drop. */
  turnsToTrim: number;
  /** Estimated history tokens before the trim. */
  tokensBefore: number;
}

/** Written once the trim (and the summary, if enabled) is complete. */
export interface CompactionDoneData {
  status: "done";
  trimmedTurns: number;
  tokensBefore: number;
  tokensAfter: number;
  /**
   * False when `HISTORY_SUMMARY_ENABLED` is off, or when the summariser failed
   * and left nothing to replay. The turns are dropped either way — this says
   * whether anything stands in for them.
   */
  summarised: boolean;
  /** Deployment that wrote the summary. Absent when `summarised` is false. */
  summaryModel?: string;
  /** Wall-clock of the trim, including the summariser call. */
  durationMs: number;
  /**
   * The summary text itself, so "Show summary" needs no second request. Capped
   * by the summariser's own output ceiling (2,000 tokens), which is small
   * enough to ship inline.
   */
  summaryText?: string;
}

export type CompactionData = CompactionRunningData | CompactionDoneData;

/** The part as it goes on the wire and onto the message. */
export interface CompactionDataPart {
  type: typeof COMPACTION_DATA_PART_TYPE;
  id: typeof COMPACTION_PART_ID;
  data: CompactionData;
}

/**
 * What a completed compaction produced. Assembled where the trim happens
 * (thread-context) and carried to the route, which turns it into the part
 * below.
 */
export interface HistoryCompactionOutcome {
  trimmedTurns: number;
  tokensBefore: number;
  tokensAfter: number;
  summarised: boolean;
  summaryModel?: string;
  durationMs: number;
  summaryText?: string;
  /** Newest row the summary covers through — the divider's anchor on reload. */
  coversThroughMessageId?: string;
}

export function compactionRunningPart(input: {
  turnsToTrim: number;
  tokensBefore: number;
}): CompactionDataPart {
  return {
    type: COMPACTION_DATA_PART_TYPE,
    id: COMPACTION_PART_ID,
    data: {
      status: "running",
      turnsToTrim: input.turnsToTrim,
      tokensBefore: input.tokensBefore,
    },
  };
}

export function compactionDonePart(
  outcome: HistoryCompactionOutcome,
): CompactionDataPart {
  const data: CompactionDoneData = {
    status: "done",
    trimmedTurns: outcome.trimmedTurns,
    tokensBefore: outcome.tokensBefore,
    tokensAfter: outcome.tokensAfter,
    summarised: outcome.summarised,
    durationMs: outcome.durationMs,
  };
  // Omit rather than send undefined: the part is JSON on the wire, and an
  // absent field reads the same on both sides.
  if (outcome.summaryModel) data.summaryModel = outcome.summaryModel;
  if (outcome.summaryText) data.summaryText = outcome.summaryText;
  return { type: COMPACTION_DATA_PART_TYPE, id: COMPACTION_PART_ID, data };
}

/**
 * The persisted marker, as the thread page hands it to the transcript.
 *
 * Deliberately a small plain object rather than the Cosmos row: it crosses the
 * server/client boundary, so it carries only what the divider renders and none
 * of the row's ids, dates or user hash.
 */
export interface ThreadCompactionMarker {
  /** Newest message the summary covers. The divider renders after this row. */
  coversThroughMessageId: string;
  summaryText?: string;
  summaryModel?: string;
}

/**
 * Narrow a persisted `CHAT_HISTORY_SUMMARY` row to the marker, or null when
 * there is nothing to mark. A row with an empty `content` is still a marker:
 * the turns were dropped, there is just no summary to expand (the feature was
 * off, or the summariser failed).
 */
export function threadCompactionMarker(
  row:
    | {
        coversThroughMessageId?: string | null;
        content?: string | null;
        model?: string | null;
      }
    | null
    | undefined,
): ThreadCompactionMarker | null {
  const watermark = row?.coversThroughMessageId;
  if (!watermark) return null;
  const summaryText = row?.content?.trim() || undefined;
  const summaryModel = row?.model?.trim() || undefined;
  return {
    coversThroughMessageId: watermark,
    ...(summaryText ? { summaryText } : {}),
    // A model name without a summary would be a label on nothing.
    ...(summaryText && summaryModel ? { summaryModel } : {}),
  };
}

/**
 * Where the persisted divider goes, and how many turns it stands for.
 *
 * The watermark row is still IN the transcript — a trim drops turns from the
 * prompt, never from Cosmos — so the divider is drawn immediately after it,
 * which is exactly where the conversation the model sees begins.
 *
 * The turn count is derived rather than stored: every user turn at or before
 * the watermark is one the model can no longer quote. (The row's own
 * `coversMessageCount` counts ROWS, cumulatively, so it would say something
 * different and less useful.)
 *
 * Returns null when the watermark row is not in the transcript — the user
 * rewound or deleted messages. Better no divider than one in the wrong place;
 * the same fail-open rule the prompt side applies in `applyHistoryWatermark`.
 */
export function compactionMarkerPlacement(input: {
  marker: ThreadCompactionMarker | null | undefined;
  messages: readonly { id: string; role: string }[];
}): { afterMessageId: string; trimmedTurns: number } | null {
  const watermark = input.marker?.coversThroughMessageId;
  if (!watermark) return null;
  const index = input.messages.findIndex((m) => m.id === watermark);
  if (index === -1) return null;
  let trimmedTurns = 0;
  for (let i = 0; i <= index; i++) {
    if (input.messages[i].role === "user") trimmedTurns++;
  }
  return { afterMessageId: watermark, trimmedTurns };
}

/** Narrowing helper for the transcript's part switch. */
export function isCompactionDataPart(part: {
  type?: string;
}): part is CompactionDataPart {
  return part?.type === COMPACTION_DATA_PART_TYPE;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * Round tokens to a short label: 96 000 -> "96k". Under 1,000 the exact number
 * is shown, because "0k" is not a fact anyone wants.
 *
 * Rounds rather than floors so 95 600 reads as "96k". The number is an
 * estimate to begin with (see history-budget.ts), so precision here would be a
 * false promise.
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens < 1000) return String(Math.round(tokens));
  return `${Math.round(tokens / 1000)}k`;
}

/** "12 older turns" / "1 older turn". */
function turnLabel(count: number): string {
  return `${count} older ${count === 1 ? "turn" : "turns"}`;
}

/**
 * The one line the divider shows. Plain English, short sentences, and it says
 * what happened rather than what the feature is called.
 */
export function compactionNoticeText(data: CompactionData): string {
  if (data.status === "running") return "Compacting older messages…";
  const tokens = `(${formatTokenCount(data.tokensBefore)} → ${formatTokenCount(
    data.tokensAfter,
  )} tokens)`;
  if (!data.summarised) {
    return `Trimmed ${turnLabel(data.trimmedTurns)} (no summary, feature off)`;
  }
  return `Compacted ${turnLabel(data.trimmedTurns)} into a summary ${tokens}`;
}

/** The persisted marker's line, shown after a reload. */
export function compactionMarkerText(trimmedTurns: number): string {
  return `Conversation compacted here · ${turnLabel(trimmedTurns)}`;
}
