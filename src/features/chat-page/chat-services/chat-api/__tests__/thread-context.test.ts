import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("@/features/common/services/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// ── Auth ──────────────────────────────────────────────────────────────────────
vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "user-hash"),
  getCurrentUser: vi.fn(async () => ({
    name: "Test User",
    email: "test@example.com",
    isAdmin: false,
  })),
}));

// ── Thread service ────────────────────────────────────────────────────────────
const mockEnsureThread = vi.fn();
const mockUpdateThreadUsage = vi.fn(async () => ({ status: "OK" }));
vi.mock("../../chat-thread-service", () => ({
  EnsureChatThreadOperation: (...a: unknown[]) => mockEnsureThread(...a),
  UpdateChatThreadUsage: (...a: unknown[]) => mockUpdateThreadUsage(...a),
}));

// ── Message service ───────────────────────────────────────────────────────────
const mockFindHistory = vi.fn();
const mockCreateMessage = vi.fn(async () => ({ status: "OK" }));
vi.mock("../../chat-message-service", () => ({
  FindAllChatMessagesForCurrentUser: (...a: unknown[]) => mockFindHistory(...a),
  CreateChatMessage: (...a: unknown[]) => mockCreateMessage(...a),
}));

// ── History summary service ───────────────────────────────────────────────────
// Stands in for both Cosmos and the summariser model. `recordHistoryCompaction`
// is the expensive call (one model round-trip per trim), so counting it is how
// these tests assert that a trim happens once and is then reused.
let summaryRow: any = null;
let summaryEnabled = false;
const mockFindSummary = vi.fn(async () => summaryRow);
const mockRecordCompaction = vi.fn(
  async (input: {
    threadId: string;
    coversThroughMessageId: string;
    droppedMessages: unknown[];
    previous?: any;
  }) => {
    summaryRow = {
      id: `summary-${input.threadId}`,
      type: "CHAT_HISTORY_SUMMARY",
      threadId: input.threadId,
      userId: "user-hash",
      isDeleted: false,
      createdAt: new Date("2026-09-07"),
      role: "system",
      kind: "summary",
      content: summaryEnabled ? "FACTS: the earlier turns said things." : "",
      coversThroughMessageId: input.coversThroughMessageId,
      coversMessageCount:
        (input.previous?.coversMessageCount ?? 0) + input.droppedMessages.length,
      model: summaryEnabled ? "luna-dep" : "",
      estimatedTokens: summaryEnabled ? 10 : 0,
    };
    return summaryRow;
  },
);
vi.mock("../history-summary-service", () => ({
  FindChatHistorySummary: (...a: unknown[]) => mockFindSummary(...(a as [])),
  recordHistoryCompaction: (...a: unknown[]) =>
    mockRecordCompaction(...(a as [any])),
  isHistorySummaryEnabled: () => summaryEnabled,
}));

// ── Document service ──────────────────────────────────────────────────────────
vi.mock("../../chat-document-service", () => ({
  FindAllChatDocuments: vi.fn(async () => ({ status: "OK", response: [] })),
}));

// ── Extension service ─────────────────────────────────────────────────────────
vi.mock("@/features/extensions-page/extension-services/extension-service", () => ({
  FindAllExtensionForCurrentUserAndIds: vi.fn(async () => ({ status: "OK", response: [] })),
}));

// ── Responses API mapper (async, just return empty array for these tests) ─────
vi.mock("../../utils", () => ({
  mapOpenAIChatMessages: vi.fn(async () => []),
}));

import { loadThreadContext } from "../thread-context";
import { MESSAGE_ATTRIBUTE } from "../../models";
import type { ChatThreadModel, UserPrompt } from "../../models";
import { SUMMARY_REPLAY_PREFIX } from "../history-summary";
import { CHARS_PER_TOKEN } from "../history-budget";

beforeEach(() => {
  summaryRow = null;
  summaryEnabled = false;
  delete process.env.HISTORY_TOKEN_BUDGET;
  mockFindSummary.mockClear();
  mockRecordCompaction.mockClear();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeThread(id = "thread-001"): ChatThreadModel {
  return {
    id,
    createdAt: new Date("2026-01-01"),
    isDeleted: false,
    userId: "user-hash",
    name: "Test thread",
    type: "CHAT_THREAD",
    bookmarked: false,
    selectedModel: "gpt-5.4-mini",
    extension: [],
    personaDocumentIds: [],
    attachedFiles: [],
  } as unknown as ChatThreadModel;
}

function makeUserPrompt(threadId = "thread-001"): UserPrompt {
  return {
    id: threadId,
    message: "Hello world",
    multimodalImage: undefined,
    multimodalImages: [],
  } as unknown as UserPrompt;
}

let rowSeq = 0;
function makeHistoryRow(
  role: "user" | "assistant",
  content: string,
  id?: string,
) {
  rowSeq += 1;
  return {
    id: id ?? `msg-${role}-${rowSeq}`,
    createdAt: new Date("2026-01-01"),
    isDeleted: false,
    threadId: "thread-001",
    userId: "user-hash",
    name: "",
    content,
    role,
    type: MESSAGE_ATTRIBUTE,
  };
}

/** `count` user+assistant pairs, each side costing ~`tokens/2` estimated tokens. */
function makeTurns(count: number, tokensPerTurn: number) {
  const chars = Math.floor((tokensPerTurn * CHARS_PER_TOKEN) / 2);
  const rows: ReturnType<typeof makeHistoryRow>[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(makeHistoryRow("user", "u".repeat(chars)));
    rows.push(makeHistoryRow("assistant", "a".repeat(chars)));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadThreadContext — fresh thread (no history)", () => {
  it("creates thread via EnsureChatThreadOperation and returns history containing the new user turn", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });

    const ctx = await loadThreadContext(makeUserPrompt());

    expect(ctx.thread).toBe(thread);
    // loadThreadContext appends the just-written user message to history so
    // streamText doesn't trip over an empty prompt — see thread-context.ts.
    expect(ctx.history).toHaveLength(1);
    expect(ctx.history[0]?.role).toBe("user");
  });
});

describe("loadThreadContext — existing thread with history", () => {
  it("hydrates at least 1 UIMessage from 1 user + 1 assistant row", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    // FindAllChatMessagesForCurrentUser orders createdAt ASC, i.e. oldest
    // first — no reversal in thread-context any more.
    mockFindHistory.mockResolvedValue({
      status: "OK",
      response: [
        makeHistoryRow("user", "Hello"),
        makeHistoryRow("assistant", "I can help with that."),
      ],
    });

    const ctx = await loadThreadContext(makeUserPrompt());

    expect(ctx.history.length).toBeGreaterThanOrEqual(1);
    const roles = ctx.history.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });
});

describe("loadThreadContext — CreateChatMessage is called once for the new user turn", () => {
  it("calls CreateChatMessage exactly once before returning", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });
    mockCreateMessage.mockClear();

    await loadThreadContext(makeUserPrompt());

    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
    const [arg] = mockCreateMessage.mock.calls[0] as [Record<string, unknown>];
    expect(arg.role).toBe("user");
    expect(arg.content).toBe("Hello world");
    // turnId is now stamped on the user row (architect2 SEV-2 B7+B8).
    expect(typeof arg.turnId).toBe("string");
    expect(arg.turnId as string).toMatch(/^turn-/);
  });
});

describe("loadThreadContext — turnId is minted per request", () => {
  it("returns a unique turnId every call", async () => {
    const thread = makeThread();
    mockEnsureThread.mockResolvedValue({ status: "OK", response: thread });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });

    const ctxA = await loadThreadContext(makeUserPrompt());
    const ctxB = await loadThreadContext(makeUserPrompt());
    expect(ctxA.turnId).toMatch(/^turn-/);
    expect(ctxB.turnId).toMatch(/^turn-/);
    expect(ctxA.turnId).not.toBe(ctxB.turnId);
  });
});

// ---------------------------------------------------------------------------
// History loading: full thread, token budget, summary replay
// ---------------------------------------------------------------------------

describe("chat-page.unit.thread-context.001 — the chat path loads the whole thread", () => {
  it("calls the un-capped loader with only the thread id (no row limit)", async () => {
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });

    await loadThreadContext(makeUserPrompt());

    expect(mockFindHistory).toHaveBeenCalledWith("thread-001");
    // The old `TOP 30` path passed a row cap here; a second argument would
    // mean the sliding window is back.
    expect(mockFindHistory.mock.calls[0]).toHaveLength(1);
  });

  it("keeps far more than 30 rows when they fit the token budget", async () => {
    // 100 tiny turns = 200 rows, a few thousand estimated tokens. Under the
    // old cap the model saw 30 rows; it must now see all of them.
    const rows = makeTurns(100, 40);
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: rows });

    const ctx = await loadThreadContext(makeUserPrompt());

    // 200 history rows + the current user turn.
    expect(ctx.history).toHaveLength(201);
    expect(mockRecordCompaction).not.toHaveBeenCalled();
  });

  it("treats loaded rows as oldest-first without reversing them", async () => {
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({
      status: "OK",
      response: [
        makeHistoryRow("user", "first question"),
        makeHistoryRow("assistant", "first answer"),
        makeHistoryRow("user", "second question"),
      ],
    });

    const ctx = await loadThreadContext(makeUserPrompt());
    const texts = ctx.history.map((m) =>
      m.parts.map((p) => (p as { text?: string }).text ?? "").join(""),
    );
    expect(texts.indexOf("first question")).toBeLessThan(
      texts.indexOf("first answer"),
    );
    expect(texts.indexOf("first answer")).toBeLessThan(
      texts.indexOf("second question"),
    );
  });
});

describe("chat-page.unit.thread-context.002 — the token budget trims once and the trim sticks", () => {
  it("records the compaction exactly once across two loads", async () => {
    // The property that matters: the summariser (and the Cosmos write) run on
    // the turn that trims, and NOT on the turns after it. A per-turn call here
    // would mean the prefix moves every turn, which is the failure this whole
    // change removes.
    process.env.HISTORY_TOKEN_BUDGET = "10000";
    summaryEnabled = true;
    const rows = makeTurns(40, 500); // ~20,000 estimated tokens
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: rows });

    const first = await loadThreadContext(makeUserPrompt());
    expect(mockRecordCompaction).toHaveBeenCalledTimes(1);

    // Second turn: the same rows come back from Cosmos (a trim deletes
    // nothing) plus a new turn. The persisted watermark must absorb them.
    mockFindHistory.mockResolvedValue({
      status: "OK",
      response: [...rows, ...makeTurns(1, 200)],
    });
    const second = await loadThreadContext(makeUserPrompt());

    expect(mockRecordCompaction).toHaveBeenCalledTimes(1);
    // And the prefix did not move: same first item in the list that reaches
    // the model (the replayed summary), both turns.
    const firstItem = (m: typeof first) =>
      m.modelHistory[0].parts
        .map((p) => (p as { text?: string }).text ?? "")
        .join("");
    expect(firstItem(second)).toBe(firstItem(first));
  });

  it("passes the newest dropped row as the watermark", async () => {
    process.env.HISTORY_TOKEN_BUDGET = "10000";
    const rows = makeTurns(40, 500);
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: rows });

    await loadThreadContext(makeUserPrompt());

    const call = mockRecordCompaction.mock.calls[0][0] as unknown as {
      coversThroughMessageId: string;
      droppedMessages: { id: string }[];
    };
    const dropped = call.droppedMessages;
    expect(dropped.length).toBeGreaterThan(0);
    expect(call.coversThroughMessageId).toBe(dropped[dropped.length - 1].id);
  });

  it("cuts at a turn boundary, so the oldest surviving row is a user row", async () => {
    process.env.HISTORY_TOKEN_BUDGET = "10000";
    const rows = makeTurns(40, 500);
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: rows });

    const ctx = await loadThreadContext(makeUserPrompt());
    expect(ctx.history[0].role).toBe("user");
    expect(ctx.history.length).toBeLessThan(rows.length);
  });

  it("does not trim, or call the summariser, when the thread fits", async () => {
    process.env.HISTORY_TOKEN_BUDGET = "100000";
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: makeTurns(20, 100) });

    const ctx = await loadThreadContext(makeUserPrompt());

    expect(mockRecordCompaction).not.toHaveBeenCalled();
    expect(ctx.history).toHaveLength(41); // 40 rows + current turn
  });
});

describe("chat-page.unit.thread-context.003 — a stored summary is replayed, not regenerated", () => {
  function storedSummary(overrides: Record<string, unknown> = {}) {
    return {
      id: "summary-thread-001",
      type: "CHAT_HISTORY_SUMMARY",
      threadId: "thread-001",
      userId: "user-hash",
      isDeleted: false,
      createdAt: new Date("2026-09-01"),
      role: "system",
      kind: "summary",
      content: "FACTS: answer in metric units.",
      coversThroughMessageId: "msg-watermark",
      coversMessageCount: 4,
      model: "luna-dep",
      estimatedTokens: 8,
      ...overrides,
    };
  }

  it("puts the summary first, prefixed, and reuses it with no new call", async () => {
    summaryRow = storedSummary();
    const rows = [
      makeHistoryRow("user", "old question", "msg-old"),
      makeHistoryRow("assistant", "old answer", "msg-watermark"),
      makeHistoryRow("user", "recent question"),
      makeHistoryRow("assistant", "recent answer"),
    ];
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: rows });

    const ctx = await loadThreadContext(makeUserPrompt());

    const first = ctx.modelHistory[0];
    const firstText = first.parts
      .map((p) => (p as { text?: string }).text ?? "")
      .join("");
    expect(firstText.startsWith(SUMMARY_REPLAY_PREFIX)).toBe(true);
    expect(firstText).toContain("FACTS: answer in metric units.");
    // A user message, so every provider seam handles it without change.
    expect(first.role).toBe("user");
    // Reused, not regenerated.
    expect(mockRecordCompaction).not.toHaveBeenCalled();

    // Scaffolding stays out of `history`, which callers still use to count
    // turns and as `originalMessages` for the browser.
    expect(
      ctx.history.some((m) =>
        m.parts.some((p) =>
          ((p as { text?: string }).text ?? "").includes(SUMMARY_REPLAY_PREFIX),
        ),
      ),
    ).toBe(false);

    // The watermarked rows are gone from the prompt but still in Cosmos.
    const allText = ctx.modelHistory
      .flatMap((m) => m.parts.map((p) => (p as { text?: string }).text ?? ""))
      .join(" ");
    expect(allText).not.toContain("old question");
    expect(allText).toContain("recent question");
  });

  it("replays nothing when the row is a watermark with no summary text", async () => {
    // The feature can be off while the watermark still holds; an empty summary
    // must not put a bare heading in front of the conversation.
    summaryRow = storedSummary({ content: "", model: "", estimatedTokens: 0 });
    const rows = [
      makeHistoryRow("user", "old question", "msg-old"),
      makeHistoryRow("assistant", "old answer", "msg-watermark"),
      makeHistoryRow("user", "recent question"),
    ];
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: rows });

    const ctx = await loadThreadContext(makeUserPrompt());
    const firstText = ctx.modelHistory[0].parts
      .map((p) => (p as { text?: string }).text ?? "")
      .join("");
    expect(firstText).not.toContain(SUMMARY_REPLAY_PREFIX);
    expect(firstText).toContain("recent question");
  });

  it("falls back to the full history when the watermark row is gone", async () => {
    summaryRow = storedSummary({
      coversThroughMessageId: "a-row-the-user-deleted",
    });
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({
      status: "OK",
      response: [makeHistoryRow("user", "still here")],
    });

    const ctx = await loadThreadContext(makeUserPrompt());
    const allText = ctx.modelHistory
      .flatMap((m) => m.parts.map((p) => (p as { text?: string }).text ?? ""))
      .join(" ");
    expect(allText).toContain("still here");
  });
});

describe("chat-page.unit.thread-context.004 — the document hint is deterministic", () => {
  /** The hint rides in the prompt tail as a system message; read it back. */
  const hintTextOf = (ctx: {
    modelHistory: { role: string; parts: unknown[] }[];
  }) =>
    ctx.modelHistory
      .filter((m) => m.role === "system")
      .flatMap((m) => m.parts.map((p) => (p as { text?: string }).text ?? ""))
      .join("");

  it("lists document names in sorted order regardless of Cosmos order", async () => {
    const { FindAllChatDocuments } = await import("../../chat-document-service");
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });

    const docs = [
      { id: "d1", name: "zeta.pdf" },
      { id: "d2", name: "alpha.pdf" },
      { id: "d3", name: "mid.pdf" },
    ];
    vi.mocked(FindAllChatDocuments).mockResolvedValue({
      status: "OK",
      response: docs,
    } as never);
    const forward = await loadThreadContext(makeUserPrompt());

    vi.mocked(FindAllChatDocuments).mockResolvedValue({
      status: "OK",
      response: [...docs].reverse(),
    } as never);
    const reversed = await loadThreadContext(makeUserPrompt());

    expect(hintTextOf(forward)).toContain("alpha.pdf, mid.pdf, zeta.pdf");
    // Byte-identical either way: the hint is a function of the document SET.
    expect(hintTextOf(reversed)).toBe(hintTextOf(forward));

    vi.mocked(FindAllChatDocuments).mockResolvedValue({
      status: "OK",
      response: [],
    } as never);
  });

  it("keeps the hint out of the developer message for an Azure-served thread", async () => {
    const { FindAllChatDocuments } = await import("../../chat-document-service");
    mockEnsureThread.mockResolvedValue({ status: "OK", response: makeThread() });
    mockFindHistory.mockResolvedValue({ status: "OK", response: [] });
    vi.mocked(FindAllChatDocuments).mockResolvedValue({
      status: "OK",
      response: [{ id: "d1", name: "manual.pdf" }],
    } as never);

    const ctx = await loadThreadContext(makeUserPrompt());

    expect(ctx.documentHintPlacement).toBe("tail-message");
    expect(ctx.documentHint).toBeUndefined();
    expect(hintTextOf(ctx)).toContain("manual.pdf");

    vi.mocked(FindAllChatDocuments).mockResolvedValue({
      status: "OK",
      response: [],
    } as never);
  });
});
