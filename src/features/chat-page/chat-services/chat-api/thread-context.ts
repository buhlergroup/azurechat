"use server";
import "server-only";

/**
 * thread-context.ts
 *
 * Loads everything needed before the streaming response begins:
 * - resolves / creates the chat thread
 * - fetches the current user
 * - loads message history and adapts it to UIMessages
 * - resolves document hints, extensions, and attached files
 * - writes the user's turn to Cosmos so that a page refresh during streaming
 *   shows the outgoing message immediately (matches today's behaviour in
 *   chat-api-response.ts).
 */

import { getCurrentUser, userHashedId } from "@/features/auth-page/helpers";
import { logError, logInfo, logWarn } from "@/features/common/services/logger";
import type { UIMessage } from "ai";
import { createIdGenerator } from "ai";
import { CreateChatMessage } from "../chat-message-service";
import { FindAllChatDocuments } from "../chat-document-service";
import { FindAllChatMessagesForCurrentUser } from "../chat-message-service";
import { EnsureChatThreadOperation } from "../chat-thread-service";
import { uiMessagesFromChatMessages } from "./message-adapter";
import { getBase64ImageReference } from "../chat-image-persistence-service";
import { isImageReference } from "../chat-image-persistence-utils";
import {
  applyHistoryWatermark,
  planHistoryTrim,
  resolveHistoryTokenBudget,
  resolveHistoryTrimTargetRatio,
  SUMMARY_TOKEN_RESERVE,
} from "./history-budget";
import {
  formatSummaryReplayText,
  historySummaryRowId,
  type ChatHistorySummaryModel,
} from "./history-summary";
import {
  FindChatHistorySummary,
  isHistorySummaryEnabled,
  recordHistoryCompaction,
} from "./history-summary-service";
import {
  AttachedFileModel,
  ChatMessageModel,
  ChatThreadModel,
  DefaultTools,
  MODEL_CONFIGS,
  UserPrompt,
} from "../models";

// ---------------------------------------------------------------------------
// History file-ref resolution
// ---------------------------------------------------------------------------

/**
 * Walks the user-message FileUIPart entries and replaces any
 * `blob://threadId/filename` reference (the canonical persistence format
 * for uploaded images and code_interpreter outputs) with a `data:`
 * URL the AI SDK can ship to the model without a network fetch.
 *
 * Why this is necessary: AI SDK v6's `convertToLanguageModelPrompt` →
 * `downloadAssets` validates every URL via `validateDownloadUrl`, which
 * rejects any scheme that isn't http(s) or data — `blob://` fails. The
 * read adapter (`uiMessagesFromChatMessages`) passes refs through
 * verbatim because it's sync and can't read blob storage. We do the
 * async resolution here, once, before history reaches streamText.
 *
 * A failed lookup is logged and the part is dropped (better than poisoning
 * the whole turn with a download error).
 */
/**
 * Replaces every `image_generation` tool output's `result` field with an
 * opaque placeholder before history reaches `convertToModelMessages`.
 *
 * Why this is necessary: the read adapter resolves `blob://` →
 * `/api/images?…` so the UI can render persisted images. If we left
 * that URL in the history that goes to the model on a follow-up turn,
 * the model echoes it as `![alt](/api/images?…)` markdown — and
 * Streamdown renders an image inline in the new assistant text. Since
 * the prior tool widget already shows the same image, the user sees
 * it twice. Stripping the URL from the model's view stops the echo;
 * the UI render path still has the URL via the same read adapter.
 *
 * Browser-render history (built by chat-page.tsx via uiMessagesFromChatMessages)
 * is a separate call and keeps the URL — only the server-side history
 * passed to streamText is stripped here.
 */
function stripImageUrlsFromToolOutputs(history: UIMessage[]): UIMessage[] {
  return history.map((msg) => {
    if (msg.role !== "assistant") return msg;
    let mutated = false;
    const newParts = msg.parts.map((p) => {
      const part = p as {
        type: string;
        toolName?: string;
        output?: unknown;
      };
      const isImageGenToolPart =
        (part.type === "dynamic-tool" && part.toolName === "image_generation") ||
        part.type === "tool-image_generation";
      if (!isImageGenToolPart) return p;
      if (!part.output || typeof part.output !== "object") return p;
      mutated = true;
      return {
        ...p,
        output: {
          ...(part.output as object),
          // Replace the URL with a hint the model can use as context
          // without being able to echo it. The tool widget on the
          // browser side still has the real URL from its own render
          // pass — this strip only affects what the model sees.
          result: "[generated image displayed to the user]",
        },
      } as typeof p;
    });
    if (!mutated) return msg;
    return { ...msg, parts: newParts } as UIMessage;
  });
}

async function resolveHistoryFileRefs(
  history: UIMessage[],
): Promise<UIMessage[]> {
  const out: UIMessage[] = [];
  for (const msg of history) {
    if (msg.role !== "user") {
      out.push(msg);
      continue;
    }
    const newParts: UIMessage["parts"] = [];
    for (const part of msg.parts) {
      if (part.type !== "file") {
        newParts.push(part);
        continue;
      }
      const file = part as { type: "file"; url: string; mediaType?: string };
      if (!isImageReference(file.url)) {
        newParts.push(part);
        continue;
      }
      try {
        const dataUrl = await getBase64ImageReference(file.url);
        newParts.push({ ...file, url: dataUrl, mediaType: file.mediaType ?? "image/png" });
      } catch (err) {
        logWarn(
          "resolveHistoryFileRefs: failed to inline blob ref; dropping file part",
          {
            ref: file.url,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        // Skip this attachment — the model still gets the text content
        // and the next turn won't blow up on a missing blob.
      }
    }
    out.push({ ...msg, parts: newParts } as UIMessage);
  }
  return out;
}

// ---------------------------------------------------------------------------
// History compaction
// ---------------------------------------------------------------------------

/**
 * Replay a stored summary as the first conversation item.
 *
 * Role `user`, not `system`. Two reasons:
 *   - The message adapter and every provider seam already handle user
 *     messages; a mid-prompt system message is handled inconsistently across
 *     the three providers this app talks to (Azure Responses, the Azure
 *     /anthropic Messages API, and Foundry Chat Completions), and getting it
 *     right would mean touching provider files.
 *   - The developer message is assembled separately in route.ts and is
 *     process-constant; folding per-thread text into it would put a volatile
 *     segment back at the front of the prefix, which is the mistake this
 *     change set removes.
 *
 * Two consecutive user messages (this one and the oldest surviving turn) are
 * fine: the Anthropic seam groups same-role messages into one block, and the
 * OpenAI surfaces accept the sequence as-is.
 *
 * The id is derived from the thread so it is stable across turns.
 */
function summaryReplayMessage(
  threadId: string,
  summary: ChatHistorySummaryModel,
): UIMessage {
  return {
    id: historySummaryRowId(threadId),
    role: "user",
    parts: [
      { type: "text", text: formatSummaryReplayText(summary.content) },
    ],
  };
}

/**
 * Apply the persisted watermark, then the token budget, to a thread's rows.
 *
 * Order matters. The watermark comes first: rows an earlier trim already
 * accounted for must leave before anything is measured, otherwise the budget
 * would keep re-discovering them and keep moving the cut forward one turn at a
 * time. Only what survives the watermark is weighed against the budget.
 *
 * When a trim does happen this records it (advancing the watermark and, if the
 * feature is on, summarising the dropped block) before returning. That write is
 * the one thing standing between this design and the sliding window it
 * replaced, so it is awaited rather than fired and forgotten.
 *
 * Returns the rows to send and the summary to replay, if any.
 */
async function compactHistory(input: {
  threadId: string;
  selectedModel: ChatThreadModel["selectedModel"];
  rows: ChatMessageModel[];
}): Promise<{ rows: ChatMessageModel[]; summary: ChatHistorySummaryModel | null }> {
  const existingSummary = await FindChatHistorySummary(input.threadId);

  const { retained, alreadyCompacted } = applyHistoryWatermark(
    input.rows,
    existingSummary?.coversThroughMessageId,
  );

  const summaryEnabled = isHistorySummaryEnabled();
  // The budget follows the thread's selected model, not the effective model
  // resolved later in route.ts. A downgrade changes who answers the turn, not
  // how much of the thread is worth carrying, and reading it here keeps the
  // decision (and therefore the prefix) independent of per-turn routing.
  const budget = resolveHistoryTokenBudget({
    modelBudget: input.selectedModel
      ? MODEL_CONFIGS[input.selectedModel]?.historyTokenBudget
      : undefined,
    envBudget: process.env.HISTORY_TOKEN_BUDGET,
  });

  const plan = planHistoryTrim(retained, {
    budget,
    targetRatio: resolveHistoryTrimTargetRatio({
      envRatio: process.env.HISTORY_TRIM_TARGET_RATIO,
    }),
    existingSummaryTokens: existingSummary?.estimatedTokens ?? 0,
    summaryReserveTokens: summaryEnabled ? SUMMARY_TOKEN_RESERVE : 0,
  });

  if (!plan.trimmed) {
    if (plan.targetUnreachable) {
      // Over budget with nothing left that may be dropped: the surviving turns
      // alone exceed the target. Nothing to do but let it through — the
      // alternative is trimming the question being answered — but it is worth
      // seeing in the logs, because it means one turn is very large.
      logWarn("thread-context: history over budget but nothing trimmable", {
        threadId: input.threadId,
        estimatedTokens: plan.estimatedTokensBefore,
        budget: plan.budget,
        turnCount: plan.keptTurnCount,
      });
    }
    return { rows: plan.kept, summary: summaryWithContent(existingSummary) };
  }

  logInfo("thread-context: trimmed history to token budget", {
    threadId: input.threadId,
    budget: plan.budget,
    target: plan.target,
    estimatedTokensBefore: plan.estimatedTokensBefore,
    estimatedTokensAfter: plan.estimatedTokensAfter,
    droppedTurnCount: plan.droppedTurnCount,
    keptTurnCount: plan.keptTurnCount,
    droppedMessageCount: plan.dropped.length,
    previouslyCompactedMessageCount: alreadyCompacted.length,
    summaryEnabled,
  });

  const recorded = await recordHistoryCompaction({
    threadId: input.threadId,
    userId: await userHashedId(),
    droppedMessages: plan.dropped,
    coversThroughMessageId: plan.coversThroughMessageId!,
    previous: existingSummary,
  });

  // A failed write leaves the watermark where it was. This turn is still
  // trimmed (the user gets the cheap prompt); the next turn will re-derive the
  // same cut and try the write again.
  return {
    rows: plan.kept,
    summary: summaryWithContent(recorded ?? existingSummary),
  };
}

/**
 * Narrow a compaction row to one worth replaying. A row with empty `content`
 * is a watermark only — the block was trimmed without being summarised — and
 * replaying an empty summary would put a bare heading in front of the
 * conversation.
 */
function summaryWithContent(
  summary: ChatHistorySummaryModel | null,
): ChatHistorySummaryModel | null {
  if (!summary) return null;
  return summary.content.trim().length > 0 ? summary : null;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ThreadContextUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface ThreadContext {
  thread: ChatThreadModel;
  user: ThreadContextUser;
  /**
   * The real conversation in AI SDK UIMessage format, oldest-first, ending
   * with the turn the user just submitted. Persisted messages only — no
   * prompt scaffolding — so callers can still count turns (`length === 1`
   * means a first turn) and hand it to `toUIMessageStreamResponse` as
   * `originalMessages` without a synthetic item leaking to the browser.
   */
  history: UIMessage[];
  /**
   * `history` plus the prompt scaffolding, in the exact order it must reach
   * `convertToModelMessages`: the replayed summary (if any), then the
   * conversation, then the document hint (if it goes in the tail), then the
   * current user turn. This is what streamText should be given.
   */
  modelHistory: UIMessage[];
  /**
   * Document hint for the DEVELOPER message, set only when this thread's
   * provider cannot take a mid-conversation system message (see
   * `documentHintPlacement`). Undefined when the hint is already in
   * `modelHistory` — or when there are no documents at all.
   */
  documentHint: string | undefined;
  /**
   * Where the document hint ended up. `"tail-message"` keeps the developer
   * message static for the life of the thread; `"developer-message"` is the
   * fallback. Exposed for logging and tests, not for dispatch.
   */
  documentHintPlacement: "tail-message" | "developer-message" | "none";
  threadDocumentIds: string[];
  personaDocumentIds: string[];
  defaultTools: DefaultTools | undefined;
  extensions: string[];
  attachedFiles: AttachedFileModel[];
  /**
   * Stable identifier for this turn. Stamped on the user row written at
   * load time and threaded through to persistAssistantFromFinishEvent so
   * every row written during the turn shares it. Enables partial-turn
   * detection.
   */
  turnId: string;
}

// ---------------------------------------------------------------------------
// loadThreadContext
// ---------------------------------------------------------------------------

/**
 * Resolves all context required before a streaming request is dispatched.
 *
 * Side-effect: writes the user's outgoing message to Cosmos before the stream
 * starts, mirroring the behaviour in chat-api-response.ts line 135-143.
 *
 * Throws with { status: 401 } attached if the thread authorisation check fails.
 */
const userMessageIdGenerator = createIdGenerator({ prefix: "user", size: 16 });
const turnIdGenerator = createIdGenerator({ prefix: "turn", size: 16 });

export async function loadThreadContext(
  payload: UserPrompt
): Promise<ThreadContext> {
  // 1. Resolve / create thread
  const threadResponse = await EnsureChatThreadOperation(payload.id);
  if (threadResponse.status !== "OK") {
    const err = Object.assign(
      new Error("Unauthorized"),
      { status: 401 }
    );
    throw err;
  }
  const thread = threadResponse.response;

  // 2. Current user (needed for message authorship)
  const currentUser = await getCurrentUser();
  const user: ThreadContextUser = {
    id: currentUser.email, // consistent with hashValue usage elsewhere
    name: currentUser.name,
    email: currentUser.email,
    isAdmin: currentUser.isAdmin,
  };

  // 3. History.
  //
  // The whole thread, not `TOP 30`. The old row cap made the prompt prefix
  // move on every turn past row 30 — see the header comment in
  // history-budget.ts for the measured cost. What limits the prompt now is an
  // estimated-token budget with turn-boundary cuts and hysteresis, so the
  // prefix holds still for dozens of turns at a time.
  const historyResponse = await FindAllChatMessagesForCurrentUser(thread.id);
  const allRows = historyResponse.status === "OK" ? historyResponse.response : [];
  if (historyResponse.status !== "OK") {
    logError("Error getting history", { errors: historyResponse.errors });
  }
  // FindAllChatMessagesForCurrentUser orders by createdAt ASC, which is the
  // oldest-first order every adapter downstream expects.

  const { rows: keptRows, summary: activeSummary } = await compactHistory({
    threadId: thread.id,
    selectedModel: thread.selectedModel,
    rows: allRows,
  });

  const history = await resolveHistoryFileRefs(
    uiMessagesFromChatMessages(keptRows),
  );

  // The summary replaces the rows it covers, so it goes at the very front of
  // the conversation — immediately after the developer message.
  const summaryPrefix: UIMessage[] = activeSummary
    ? [summaryReplayMessage(thread.id, activeSummary)]
    : [];

  // 4. Documents
  const documentsResponse = await FindAllChatDocuments(thread.id);
  const hasChatDocuments =
    documentsResponse.status === "OK" &&
    documentsResponse.response.length > 0;
  const chatDocumentIds: string[] =
    hasChatDocuments
      ? documentsResponse.response.map((d) => d.id)
      : [];
  const personaDocumentIds: string[] =
    thread.personaDocumentIds ?? [];
  const hasPersonaDocuments = personaDocumentIds.length > 0;
  const hasAnyDocuments = hasChatDocuments || hasPersonaDocuments;

  // Build document hint matching the logic in chat-api-response.ts lines 114-123
  let documentHintText: string | undefined;
  if (hasAnyDocuments) {
    // Sort the names. FindAllChatDocuments already orders by createdAt, but the
    // hint is part of the system prompt: a reshuffle here rewrites the prompt
    // prefix and voids the cache. Sorting locally makes the line a pure
    // function of the document SET, independent of insertion order or of a
    // same-millisecond createdAt tie. localeCompare with an explicit "en"
    // locale so the order can't drift with the pod's default locale.
    const documentNames = hasChatDocuments
      ? [...documentsResponse.response]
          .map((doc) => doc.name)
          .sort((a, b) => a.localeCompare(b, "en"))
          .join(", ")
      : "";
    const contextLine = hasChatDocuments
      ? `DOCUMENT CONTEXT: The user has attached the following document(s) to this conversation: ${documentNames}.`
      : `DOCUMENT CONTEXT: The user has persona-linked document(s) available for this conversation.`;
    documentHintText =
      `\n\n${contextLine}\n\n` +
      `MANDATORY BEHAVIOR WHEN DOCUMENTS ARE PRESENT:\n` +
      `- You MUST first call the search_documents tool with the user's question as the query before composing an answer.\n` +
      `- If the first page is insufficient, iterate using top (max results, default 10) and skip (offset) to gather more context (e.g., top=10, skip=10 for page 2).\n` +
      `- Ground your answer in the retrieved content and cite filenames when relevant.\n` +
      `- Do not answer purely from prior knowledge when documents are attached.`;
  }

  // 4b. Where the hint goes.
  //
  // The hint is the most volatile input to the prompt: it appears, disappears
  // and changes wording the moment a user attaches or removes a document. In
  // the developer message — even at its end — a change there is a change to
  // the FIRST item of the prompt, so nothing after it can be reused and the
  // whole thread is re-billed at the cache-write rate. Moved into the tail,
  // between the history and the current question, it changes only the last few
  // hundred bytes and the developer message plus the entire history stay
  // byte-identical and cacheable.
  //
  // Not every provider will take a system message in the middle of `messages`:
  //   - azure (Responses API): supported. @ai-sdk/openai emits it as an
  //     `input` item with role system/developer at whatever position it holds.
  //   - foundry (Chat Completions): supported. Same conversion, and the API
  //     accepts a system message at any index.
  //   - anthropic (Azure /anthropic Messages API): @ai-sdk/anthropic does
  //     handle it, but by pushing a `role: "system"` message and requesting
  //     the `mid-conversation-system-2026-04-07` beta. Whether the Azure
  //     /anthropic surface honours that beta cannot be established without a
  //     live call, and getting it wrong is a hard 400 rather than a
  //     degradation — so Claude threads keep the developer-message placement.
  const provider = thread.selectedModel
    ? MODEL_CONFIGS[thread.selectedModel]?.provider ?? "azure"
    : "azure";
  const supportsMidConversationSystem = provider !== "anthropic";
  const documentHintPlacement: ThreadContext["documentHintPlacement"] =
    documentHintText === undefined
      ? "none"
      : supportsMidConversationSystem
        ? "tail-message"
        : "developer-message";

  // 5. Extension IDs (full extension objects + header secrets are
  //    resolved later by route.ts so we don't fetch them twice).
  const extensions: string[] = thread.extension ?? [];

  // 6. Mint turnId. Stamped on the user row written below, threaded into
  //    persistAssistantFromFinishEvent so every row written during this
  //    turn carries it. Enables future per-turn reconciliation, resume,
  //    and submit-mutex without retroactive schema migrations.
  const turnId = turnIdGenerator();

  // No per-thread mutex. The architect-2 review (B5) flagged a concern
  // about two tabs interleaving turns on the same thread, but the
  // claim/release machinery added more failure modes than it
  // prevented: the release path runs in onFinish (outside Next.js's
  // request context), couldn't reliably read the partition key, and
  // ended up leaving locks stuck — every second turn 409'd. Each turn
  // mints its own turnId; Cosmos rows are tagged with it; concurrent
  // turns on the same thread now produce two valid turns with their
  // own IDs and ordering follows server timestamps. The trade-off is
  // accepting the occasional cross-tab interleave, which is cosmetic
  // and rare in practice. (Tracked in #45.)

  // 7. Write user turn to Cosmos BEFORE stream starts.
  //    Reading history (step 3) happens first, so the freshly-written user
  //    message is NOT in `history`. We must append it before returning,
  //    otherwise `streamText({ messages: convertToModelMessages(history) })`
  //    is invoked with no user turn and throws AI_InvalidPromptError.
  await CreateChatMessage({
    name: user.name,
    content: payload.message,
    role: "user",
    chatThreadId: thread.id,
    multiModalImage: payload.multimodalImage,
    multiModalImages: payload.multimodalImages,
    turnId,
  });

  const userImages = payload.multimodalImages ?? (payload.multimodalImage ? [payload.multimodalImage] : []);
  const userUIMessage: UIMessage = {
    id: userMessageIdGenerator(),
    role: "user",
    parts: [
      ...(payload.message ? [{ type: "text" as const, text: payload.message }] : []),
      ...userImages.map((url) => ({
        type: "file" as const,
        mediaType: "image/*",
        url,
      })),
    ],
  };

  // The hint as its own developer message in the prompt tail. Role "system":
  // `convertToModelMessages` maps a system UIMessage to a system ModelMessage
  // at the same index, and the provider seams then render it as a
  // system/developer item (see the placement note above).
  const documentHintMessages: UIMessage[] =
    documentHintPlacement === "tail-message" && documentHintText
      ? [
          {
            // Derived from the thread, so the item is byte-identical across
            // turns for as long as the document set is unchanged.
            id: `dochint-${thread.id}`,
            role: "system",
            parts: [{ type: "text", text: documentHintText.trimStart() }],
          },
        ]
      : [];

  return {
    thread,
    user,
    history: [...history, userUIMessage],
    modelHistory: [
      ...summaryPrefix,
      ...history,
      ...documentHintMessages,
      userUIMessage,
    ],
    documentHint:
      documentHintPlacement === "developer-message" ? documentHintText : undefined,
    documentHintPlacement,
    threadDocumentIds: chatDocumentIds,
    personaDocumentIds,
    defaultTools: thread.defaultTools,
    extensions,
    attachedFiles: thread.attachedFiles ?? [],
    turnId,
  };
}
