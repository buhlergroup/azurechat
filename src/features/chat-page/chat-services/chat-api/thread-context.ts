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

import { getCurrentUser } from "@/features/auth-page/helpers";
import { logError, logWarn } from "@/features/common/services/logger";
import type { UIMessage } from "ai";
import { createIdGenerator } from "ai";
import { CreateChatMessage } from "../chat-message-service";
import { FindAllChatDocuments } from "../chat-document-service";
import { FindTopChatMessagesForCurrentUser } from "../chat-message-service";
import { EnsureChatThreadOperation } from "../chat-thread-service";
import { uiMessagesFromChatMessages } from "./message-adapter";
import { getBase64ImageReference } from "../chat-image-persistence-service";
import { isImageReference } from "../chat-image-persistence-utils";
import {
  AttachedFileModel,
  ChatThreadModel,
  DefaultTools,
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
  /** History in AI SDK UIMessage format (oldest-first, ready to pass to streamText) */
  history: UIMessage[];
  /** System-prompt appendix injected when documents are attached */
  documentHint: string | undefined;
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

  // 3. History (parallel with nothing else right now, but cheap to parallelize later)
  const historyResponse = await FindTopChatMessagesForCurrentUser(thread.id);
  const historyRows =
    historyResponse.status === "OK" ? historyResponse.response : [];
  if (historyResponse.status !== "OK") {
    logError("Error getting history", { errors: historyResponse.errors });
  }

  // Cosmos returns rows newest-first; both adapters expect oldest-first.
  const orderedRows = [...historyRows].reverse();

  const history = await resolveHistoryFileRefs(
    uiMessagesFromChatMessages(orderedRows),
  );

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
  let documentHint: string | undefined;
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
    documentHint =
      `\n\n${contextLine}\n\n` +
      `MANDATORY BEHAVIOR WHEN DOCUMENTS ARE PRESENT:\n` +
      `- You MUST first call the search_documents tool with the user's question as the query before composing an answer.\n` +
      `- If the first page is insufficient, iterate using top (max results, default 10) and skip (offset) to gather more context (e.g., top=10, skip=10 for page 2).\n` +
      `- Ground your answer in the retrieved content and cite filenames when relevant.\n` +
      `- Do not answer purely from prior knowledge when documents are attached.`;
  }

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

  return {
    thread,
    user,
    history: [...history, userUIMessage],
    documentHint,
    threadDocumentIds: chatDocumentIds,
    personaDocumentIds,
    defaultTools: thread.defaultTools,
    extensions,
    attachedFiles: thread.attachedFiles ?? [],
    turnId,
  };
}
