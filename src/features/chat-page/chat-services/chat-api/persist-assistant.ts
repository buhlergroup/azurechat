import "server-only";

/**
 * persist-assistant.ts
 *
 * Persists the completed assistant turn to Cosmos and records usage.
 * Called from the streamText onFinish callback (or the equivalent completion
 * hook in the new /api/chat rewrite).
 *
 * Design notes:
 * - Does NOT re-walk sub-agent results; the `usage` parameter is the parent
 *   streamText total which already includes all step usage (AI SDK v6 rolls up
 *   per-step usage into the final onFinish usage object automatically).
 * - Writer plumbing for `data-usage-warning` SSE events is not yet available at
 *   this layer; errors surface as logger warnings until the cutover route passes
 *   a writer here.  TODO: accept an optional writer param and emit the event.
 */

import type {
  DynamicToolUIPart,
  OnFinishEvent,
  ReasoningUIPart,
  TextUIPart,
  ToolSet,
  TypedToolResult,
  UIMessage,
} from "ai";
import { createIdGenerator } from "ai";
import { userHashedId } from "@/features/auth-page/helpers";
import { logError, logInfo, logWarn } from "@/features/common/services/logger";
import { IncrementUsage } from "@/features/common/services/usage-service";
import {
  reportPromptTokens,
  reportCompletionTokens,
  reportCachedTokens,
  reportUserChatMessage,
} from "@/features/common/services/chat-metrics-service";
import { UpsertChatMessage } from "../chat-message-service";
import { UpdateChatThreadUsage } from "../chat-thread-service";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { MESSAGE_ATTRIBUTE } from "../models";
import type { ChatMessageModel } from "../models";
import { uniqueId } from "@/features/common/util";
import { chatMessagesFromUIMessages } from "./message-adapter";
import { rewriteSandboxUrls } from "./rewrite-sandbox-urls";
import {
  ingestContainerFileSourcesToChatStore,
  ingestImageGenerationResults,
} from "../chat-file-store-ingest";
import { ModelConfig } from "../models";

const assistantMessageIdGenerator = createIdGenerator({ prefix: "msg", size: 16 });

/**
 * Turns a streamText / provider error into a user-facing message that
 * doesn't leak stack traces, file paths, or internal scheme names into the
 * chat bubble. The technical message is still in the server log under
 * `/api/chat streamText error` so support can find it; this is the copy
 * that lands in Cosmos and on the user's screen.
 *
 * The intent: a friendly hint of what kind of failure happened plus a
 * "what to try" suggestion. Specific patterns are recognised by signature
 * (substring match on the raw message) and mapped to known causes; the
 * fallback covers everything else.
 */
export function friendlyErrorMessage(err: { message: string; name?: string }): string {
  const m = err.message ?? "";
  const lower = m.toLowerCase();

  // Rate limit / quota.
  if (
    /\b429\b|rate.?limit|quota|too many requests/i.test(m)
  ) {
    return "_⚠️ The model is currently rate-limited or over quota. Wait a few seconds and try again._";
  }

  // Auth / permissions.
  if (
    /\b401\b|\b403\b|unauthorized|forbidden|permission|access denied/i.test(m)
  ) {
    return "_⚠️ The request was refused for permission reasons. Try signing out and back in, or contact your administrator if this keeps happening._";
  }

  // Content filter / policy.
  if (
    /content[_ ]?filter|content[_ ]?policy|safety|moderation|inappropriate/i.test(m)
  ) {
    return "_⚠️ The response was blocked by a content safety filter. Try rephrasing your request._";
  }

  // Abort / cancellation.
  if (
    err.name === "AbortError" || /aborted|cancelled|canceled/i.test(lower)
  ) {
    return "_⚠️ The request was cancelled before completing. Send your message again to retry._";
  }

  // Timeout.
  if (/timeout|timed out|deadline exceeded/i.test(lower)) {
    return "_⚠️ The model took too long to respond. Try a shorter prompt or a different model._";
  }

  // Network / fetch.
  if (
    /failed to fetch|network|ECONN|ENOTFOUND|fetch failed|EAI_AGAIN/i.test(m)
  ) {
    return "_⚠️ Couldn't reach the model service. Check your connection and try again._";
  }

  // Tool / asset download issues (e.g. blob:// scheme rejection).
  if (
    err.name === "AI_DownloadError" || /url scheme must|invalid url|ssrf/i.test(lower)
  ) {
    return "_⚠️ One of the attachments on this thread couldn't be loaded for the model. Try starting a fresh chat — and ping support if it keeps happening on new threads too._";
  }

  // Generic fallback. No internal error text, no model names.
  return "_⚠️ Something went wrong generating the reply. Please try again, or start a new chat if it keeps happening._";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsagePayload {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface PersistPayload {
  threadId: string;
  /**
   * Stamp on every row persisted here so all rows of one turn share one
   * id — enables partial-turn detection on next load + resume-by-turn.
   */
  turnId?: string;
  /** The final assistant + any tool messages as UIMessages */
  messages: UIMessage[];
  modelConfig: ModelConfig;
  fallbackInfo?: {
    originalModel: string;
    fallbackModel: string;
    message: string;
    limitType: "tokens" | "cost";
    currentUsage: number;
    limit: number;
  };
  /** Token usage from the top-level streamText finish callback */
  usage: UsagePayload;
}

// ---------------------------------------------------------------------------
// persistThread
// ---------------------------------------------------------------------------

/**
 * Persists the assistant turn and updates usage counters.
 *
 * 1. Converts UIMessages → ChatMessageModel rows via chatMessagesFromUIMessages.
 * 2. Upserts each row to Cosmos with the thread ID stamped.
 * 3. Computes cost from usage + modelConfig.pricing.
 * 4. Fires IncrementUsage + UpdateChatThreadUsage (fire-and-forget — these
 *    should never block the response).
 *
 * Errors from persistence are logged as warnings rather than thrown, since the
 * stream has already finished when this is called and there is nothing the
 * client can do about a Cosmos write failure.
 */
export async function persistThread({
  threadId,
  turnId,
  messages,
  modelConfig,
  usage,
}: PersistPayload): Promise<void> {
  const userId = await userHashedId();

  // Convert UIMessages to Cosmos rows
  const rows = chatMessagesFromUIMessages(messages, {
    threadId,
    userId,
  });

  // The user's most recent turn was already persisted by loadThreadContext
  // before the stream started (so a page refresh during streaming shows the
  // outgoing message). Skip user rows here to avoid double-writing.
  const rowsToPersist = rows
    .filter((row) => row.role !== "user")
    .map<ChatMessageModel>((row) => ({
      ...(row as ChatMessageModel),
      id: row.id || uniqueId(),
      createdAt: row.createdAt || new Date(),
      type: MESSAGE_ATTRIBUTE,
      isDeleted: false,
      threadId,
      userId,
      turnId,
    }));

  // Atomic-turn persist (architect SERIOUS #20): Cosmos transactional
  // batch — all rows of a turn commit or none, eliminating "assistant
  // row written but tool rows lost" partial-turn failure modes. Batch
  // requires shared partition key (userId, shared by construction here)
  // and ≤ 100 ops. We fall back to sequential upserts if the batch
  // call fails for any reason (Cosmos limit, partition mismatch in
  // future schema changes, network) so durability isn't strictly worse
  // than the old code path.
  let usedBatch = false;
  if (rowsToPersist.length > 0 && rowsToPersist.length <= 100) {
    try {
      // Cosmos batch's `resourceBody` is typed as `JSONObject` and
      // refuses `Date` instances at the type level. Pre-serialise the
      // single Date field (`createdAt`) to an ISO string so the body
      // is structurally JSONObject-compatible without a cast. The
      // sequential UpsertChatMessage fallback path JSON-serialises
      // dates implicitly, so behaviour is consistent across both.
      const operations = rowsToPersist.map((row) => ({
        operationType: "Upsert" as const,
        resourceBody: {
          ...row,
          createdAt:
            row.createdAt instanceof Date
              ? row.createdAt.toISOString()
              : row.createdAt,
        },
      }));
      const response = await HistoryContainer().items.batch(operations, userId);
      // Batch is atomic — Cosmos returns 200 only if every op succeeded;
      // 207/4xx means at least one failed and the whole batch rolled back.
      if (response.code !== undefined && response.code >= 200 && response.code < 300) {
        usedBatch = true;
        logInfo("Persisted turn rows atomically via batch", {
          rowCount: rowsToPersist.length,
          threadId,
          turnId,
        });
      } else {
        logWarn("Cosmos batch returned non-2xx; falling back to sequential upserts", {
          code: response.code,
          threadId,
          turnId,
        });
      }
    } catch (batchErr) {
      logWarn("Cosmos batch threw; falling back to sequential upserts", {
        error: batchErr instanceof Error ? batchErr.message : String(batchErr),
        threadId,
        turnId,
      });
    }
  }

  if (!usedBatch) {
    for (const row of rowsToPersist) {
      try {
        const result = await UpsertChatMessage(row);
        if (result.status !== "OK") {
          logWarn("UpsertChatMessage returned non-OK", {
            role: row.role,
            errors: result.errors,
            threadId,
          });
        }
      } catch (err) {
        logError("Failed to persist chat message", {
          error: err instanceof Error ? err.message : String(err),
          role: row.role,
          threadId,
        });
      }
    }
  }

  // Calculate cost
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cachedTokens = usage.cachedTokens ?? 0;

  const pricing = modelConfig.pricing;
  let costUsd = 0;
  if (pricing) {
    const nonCachedInput = inputTokens - cachedTokens;
    costUsd =
      (nonCachedInput / 1_000_000) * pricing.inputPerMillion +
      (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion +
      (outputTokens / 1_000_000) * pricing.outputPerMillion;
  }

  logInfo("Persisting assistant turn usage", {
    threadId,
    modelId: modelConfig.id,
    inputTokens,
    outputTokens,
    cachedTokens,
    costUsd,
    rowCount: rows.length,
  });

  // Awaited (not fire-and-forget): the usage write is a read-modify-write
  // on the same thread row that future turns will read, so the next
  // claim sees current usage counters.
  try {
    const usageRes = await UpdateChatThreadUsage(
      threadId,
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd,
    );
    if (usageRes.status !== "OK") {
      logWarn("UpdateChatThreadUsage returned non-OK", {
        threadId,
        errors: usageRes.errors,
      });
    }
  } catch (err) {
    logError("Failed to update thread usage", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // IncrementUsage writes to a different document (the per-user usage
  // counter, not the thread); no race with the mutex release, so
  // fire-and-forget is still fine.
  IncrementUsage(
    userId,
    modelConfig.id,
    inputTokens,
    outputTokens,
    cachedTokens,
    costUsd
  ).catch((err: unknown) =>
    logError("Failed to increment user usage", {
      error: err instanceof Error ? err.message : String(err),
    })
  );

  // Emit App Insights custom metrics (OpenTelemetry) consumed by the
  // "Bühler GPT Usage" monitoring workbook. These were dropped when the
  // legacy orchestrator stack was removed (commit 8f818d6); the streamText
  // finish path replaced them with the Cosmos-only IncrementUsage above.
  // Re-wired here (fire-and-forget) so the workbook's per-model token /
  // cache / user tiles keep populating. chatModel/email/name are resolved
  // from the session inside chat-metrics-service.
  const model = modelConfig.id;
  const metricAttrs = { threadId };
  Promise.all([
    reportPromptTokens(inputTokens, model, "user", metricAttrs),
    reportCompletionTokens(outputTokens, model, {
      ...metricAttrs,
      totalTokens: inputTokens + outputTokens,
      inputTokens,
    }),
    reportCachedTokens(cachedTokens, model, metricAttrs),
    reportUserChatMessage(model, metricAttrs),
  ]).catch((err: unknown) =>
    logError("Failed to emit chat usage metrics", {
      error: err instanceof Error ? err.message : String(err),
    })
  );
}

// ---------------------------------------------------------------------------
// buildAssistantUIMessage / persistAssistantFromFinishEvent
//
// The route's streamText.onFinish callback gives us the LLM result as a
// StepResult-shaped event. These helpers convert that to a UIMessage and
// run it through the same persistThread path used elsewhere.
// ---------------------------------------------------------------------------

/**
 * Builds an assistant UIMessage from the bits of a streamText.onFinish
 * event we actually surface: reasoning, the final text, and tool results.
 * Tool results become DynamicToolUIPart entries so the message-adapter can
 * round-trip them through Cosmos via the same path used elsewhere.
 */
export function buildAssistantUIMessage<TOOLS extends ToolSet>(
  event: {
    readonly text: string;
    readonly reasoningText?: string;
    readonly toolResults: ReadonlyArray<TypedToolResult<TOOLS>>;
  },
  id: string,
  reasoningDurationMs?: number,
): UIMessage {
  const parts: UIMessage["parts"] = [];

  if (event.reasoningText) {
    const reasoning: ReasoningUIPart = {
      type: "reasoning",
      text: event.reasoningText,
      state: "done",
    };
    parts.push(reasoning);
  }

  if (event.text) {
    const text: TextUIPart = {
      type: "text",
      text: event.text,
      state: "done",
    };
    parts.push(text);
  }

  for (const result of event.toolResults) {
    const tool: DynamicToolUIPart = {
      type: "dynamic-tool",
      toolName: result.toolName,
      toolCallId: result.toolCallId,
      state: "output-available",
      input: result.input,
      output: result.output,
    };
    parts.push(tool);
  }

  // Carry the reasoning wall-clock on metadata (same channel as
  // reasoningState) so the message-adapter persists it and the UI can render
  // "Thought for Ns" after a reload, not just live.
  const metadata =
    reasoningDurationMs !== undefined && reasoningDurationMs > 0
      ? { reasoningDurationMs }
      : undefined;

  return { id, role: "assistant", parts, ...(metadata && { metadata }) };
}

export interface PersistAssistantFromFinishParams<TOOLS extends ToolSet> {
  threadId: string;
  /** Shared across user/assistant/tool rows of one turn. See ChatMessageModel.turnId. */
  turnId?: string;
  event: OnFinishEvent<TOOLS>;
  modelConfig: ModelConfig;
  fallbackInfo?: PersistPayload["fallbackInfo"];
  /** Stable id for the new assistant row; defaults to a generated one. */
  messageId?: string;
  /** Wall-clock the model spent reasoning this turn (ms), for the UI timer. */
  reasoningDurationMs?: number;
  /**
   * Provider error captured by streamText's onError (the AI SDK emits onError
   * but still calls onFinish with finishReason="error"). When present, the
   * sentinel text quotes the actual cause instead of the generic
   * "no content" message — so a content-filter trip, unsupported-tool
   * rejection, or auth/quota error surfaces to the user instead of being
   * hidden behind boilerplate.
   */
  streamError?: { message: string; name?: string };
}

/**
 * Persists an assistant turn from streamText's onFinish event. Used by
 * /api/chat so persistence happens when the LLM finishes — robust to the
 * client disconnecting mid-stream (user navigating to another thread).
 */
export async function persistAssistantFromFinishEvent<TOOLS extends ToolSet>({
  threadId,
  turnId,
  event,
  modelConfig,
  fallbackInfo,
  messageId,
  streamError,
  reasoningDurationMs,
}: PersistAssistantFromFinishParams<TOOLS>): Promise<void> {
  // Detect an empty finish — Azure content-filter trips, aborted streams
  // before any output, or a model error that resolves without text/tools.
  // Without a sentinel the assistant UIMessage has zero parts → an empty
  // Cosmos row → the UI renders nothing and the user thinks they hit a
  // ghost (architect2 SEV-1 B4). Inject a visible "no content" text part
  // so polling stops, the bubble renders, and the failure is auditable.
  // streamText's onFinish `event.toolResults` is ONLY the LAST step's tool
  // results (AI SDK semantics — index.d.ts: "results of the tool calls from
  // the last step"). A client-executed custom tool such as get_current_time
  // resolves in a NON-final step — the model needs a later step to turn the
  // result into prose — so its result never appears in event.toolResults and
  // was silently dropped from persistence: the tool card rendered live but
  // vanished on reload. Provider-executed built-in tools (web_search,
  // code_interpreter, image_generation) resolve within the final step, which
  // is why only custom-tool cards disappeared. Aggregate across ALL steps,
  // mirroring the onAbort persist path in route.ts.
  const allToolResults =
    event.steps && event.steps.length > 0
      ? event.steps.flatMap((s) => s.toolResults)
      : event.toolResults;

  const hasText = !!event.text;
  const hasReasoning = !!event.reasoningText;
  const hasTools = allToolResults.length > 0;
  const isEmptyFinish = !hasText && !hasReasoning && !hasTools;
  if (isEmptyFinish) {
    logWarn("persistAssistantFromFinishEvent: empty finish — writing sentinel row", {
      threadId,
      turnId,
      finishReason: (event as { finishReason?: string }).finishReason,
      streamErrorMessage: streamError?.message,
      streamErrorName: streamError?.name,
    });
  }
  const sentinelText = streamError
    ? friendlyErrorMessage(streamError)
    : "_The model didn't produce a response. Try rephrasing your message, or ask again._";

  // image_generation tool results carry the bytes as raw base64 in
  // output.result (~2 MB per 1024² PNG), which blows past Cosmos's 2 MB
  // request-size cap. Ingest them into the chat-image-service store and
  // swap each base64 for a same-origin /api/images?... URL BEFORE the
  // tool parts are persisted. See ingestImageGenerationResults for
  // details; pre-migration this was handled by processMessageForImagePersistence
  // running on assistant `content`, which no longer sees the image bytes
  // now that they live in a structured tool output.
  // TypedToolResult<TOOLS> (both the static and dynamic union members)
  // already exposes toolName/toolCallId/input/output, so it satisfies
  // ingestImageGenerationResults' structural parameter directly — no cast
  // needed. The generic flows through, so the result stays typed as
  // TypedToolResult<TOOLS>[] for buildAssistantUIMessage too.
  const ingestedToolResults = await ingestImageGenerationResults(
    threadId,
    allToolResults,
  );

  const assistant = buildAssistantUIMessage(
    {
      text: isEmptyFinish ? sentinelText : event.text,
      reasoningText: event.reasoningText,
      toolResults: ingestedToolResults,
    },
    messageId ?? assistantMessageIdGenerator(),
    reasoningDurationMs,
  );

  // Ingest every container_file_citation source the model referenced into
  // the chat file store (the same Azure-blob-backed surface images use).
  // The returned map points filename → /api/images?t=…&img=… URLs that the
  // rewriter can swap in for the unfetchable sandbox:/mnt/data/… paths.
  // We only resolve sources, not stream chunks, so the URL surface stays
  // one-and-only-one (chat-image-service).
  const eventSources = (event as { sources?: ReadonlyArray<unknown> }).sources;
  const preIngested = eventSources && eventSources.length > 0
    ? await ingestContainerFileSourcesToChatStore(
        threadId,
        eventSources as Parameters<typeof ingestContainerFileSourcesToChatStore>[1],
      )
    : undefined;

  const { messages, unresolved } = rewriteSandboxUrls([assistant], preIngested);
  if (unresolved.length > 0) {
    logWarn("persistAssistantFromFinishEvent: unresolved sandbox URLs", {
      filenames: unresolved,
      threadId,
    });
  }

  // AI SDK v6 surfaces cached tokens via inputTokenDetails.cacheReadTokens;
  // older versions used cachedInputTokens (now deprecated). Prefer the new
  // path and fall back to the deprecated one so we don't lose telemetry on
  // SDK upgrades. See task #36.
  const usageDetails = event.totalUsage as {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number };
  };
  const cachedTokens =
    usageDetails.inputTokenDetails?.cacheReadTokens ??
    usageDetails.cachedInputTokens ??
    undefined;

  await persistThread({
    threadId,
    turnId,
    messages,
    modelConfig,
    fallbackInfo,
    usage: {
      inputTokens: usageDetails.inputTokens ?? 0,
      outputTokens: usageDetails.outputTokens ?? 0,
      cachedTokens,
    },
  });
}
