import { describe, it, expect, vi } from "vitest";

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
}));

// ── Message service ───────────────────────────────────────────────────────────
const mockUpsert = vi.fn(async () => ({ status: "OK" as const }));
vi.mock("../../chat-message-service", () => ({
  UpsertChatMessage: (...a: unknown[]) => mockUpsert(...a),
}));

// ── Thread service ────────────────────────────────────────────────────────────
const mockUpdateThreadUsage = vi.fn(async () => ({ status: "OK" }));
vi.mock("../../chat-thread-service", () => ({
  UpdateChatThreadUsage: (...a: unknown[]) => mockUpdateThreadUsage(...a),
}));

// ── Usage service ─────────────────────────────────────────────────────────────
const mockIncrementUsage = vi.fn(async () => {});
vi.mock("@/features/common/services/usage-service", () => ({
  IncrementUsage: (...a: unknown[]) => mockIncrementUsage(...a),
}));

// ── Cosmos ────────────────────────────────────────────────────────────────────
// persistThread's atomic-turn path calls HistoryContainer().items.batch(); left
// unmocked it drives the real Cosmos SDK against the fake test endpoint, whose
// retry/backoff blows past the 5s test timeout. Make batch reject so the
// documented sequential-upsert fallback (UpsertChatMessage, mocked above) runs —
// the path these tests assert on.
const mockBatch = vi.fn(async () => {
  throw new Error("batch unavailable in test");
});
vi.mock("@/features/common/services/cosmos", () => ({
  HistoryContainer: () => ({ items: { batch: (...a: unknown[]) => mockBatch(...a) } }),
}));

import { persistThread } from "../persist-assistant";
import { MODEL_CONFIGS } from "../../models";
import type { UIMessage } from "ai";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINI_MODEL_ID = "gpt-5.4-mini" as const;
const modelConfig = MODEL_CONFIGS[MINI_MODEL_ID];

/** 1 user + 1 assistant (with 1 tool part) → chatMessagesFromUIMessages yields 3 rows */
function makeMessages(): UIMessage[] {
  return [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Search for azurechat" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Here are the results.", state: "done" },
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "call-001",
          state: "output-available",
          input: { query: "azurechat" },
          output: { hits: 3 },
        } as import("ai").DynamicToolUIPart,
      ],
    },
  ] as UIMessage[];
}

const BASE_PAYLOAD = {
  threadId: "thread-persist-001",
  modelConfig,
  usage: { inputTokens: 1000, outputTokens: 500, cachedTokens: 200 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("persistThread — UpsertChatMessage call count", () => {
  it("upserts every Cosmos row except the user turn — that one was already written by loadThreadContext", async () => {
    // makeMessages() produces 1 user + 1 assistant + 1 tool row. The user
    // row is intentionally skipped inside persistThread to avoid the
    // double-write loadThreadContext.CreateChatMessage already did.
    mockUpsert.mockClear();
    await persistThread({ ...BASE_PAYLOAD, messages: makeMessages() });
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const roles = mockUpsert.mock.calls.map((c) => c[0]?.role);
    expect(roles).not.toContain("user");
  });
});

describe("persistThread — usage counters", () => {
  it("calls IncrementUsage and UpdateChatThreadUsage with cost derived from pricing", async () => {
    mockIncrementUsage.mockClear();
    mockUpdateThreadUsage.mockClear();

    await persistThread({ ...BASE_PAYLOAD, messages: makeMessages() });

    // Allow fire-and-forget promises to settle.
    await new Promise((r) => setTimeout(r, 0));

    // Compute expected cost: (1000-200)/1M*0.75 + 200/1M*0.075 + 500/1M*4.50
    const pricing = modelConfig.pricing;
    const nonCached = 1000 - 200;
    const expectedCost =
      (nonCached / 1_000_000) * pricing.inputPerMillion +
      (200 / 1_000_000) * pricing.cachedInputPerMillion +
      (500 / 1_000_000) * pricing.outputPerMillion;

    expect(mockIncrementUsage).toHaveBeenCalledWith(
      "user-hash",
      MINI_MODEL_ID,
      1000,
      500,
      200,
      expectedCost
    );
    expect(mockUpdateThreadUsage).toHaveBeenCalledWith(
      "thread-persist-001",
      1000,
      500,
      200,
      expectedCost
    );
  });
});

describe("persistThread — UpsertChatMessage rejection is logged, not thrown", () => {
  it("resolves without throwing when UpsertChatMessage rejects", async () => {
    // NOTE: persistThread catches individual upsert errors via try/catch and logs them.
    // It does NOT re-throw, so callers never see the failure — this is by design per
    // the comment in persist-assistant.ts ("errors surface as logger warnings").
    mockUpsert.mockRejectedValue(new Error("Cosmos write failure"));

    await expect(
      persistThread({ ...BASE_PAYLOAD, messages: makeMessages() })
    ).resolves.toBeUndefined();
  });
});
