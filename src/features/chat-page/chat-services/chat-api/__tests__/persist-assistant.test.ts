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

// ── Chat metrics (App Insights custom metrics) ────────────────────────────────
const mockReportPromptTokens = vi.fn(async () => {});
const mockReportCompletionTokens = vi.fn(async () => {});
const mockReportCachedTokens = vi.fn(async () => {});
const mockReportCacheWriteTokens = vi.fn(async () => {});
const mockReportUserChatMessage = vi.fn(async () => {});
vi.mock("@/features/common/services/chat-metrics-service", () => ({
  reportPromptTokens: (...a: unknown[]) => mockReportPromptTokens(...(a as [])),
  reportCompletionTokens: (...a: unknown[]) =>
    mockReportCompletionTokens(...(a as [])),
  reportCachedTokens: (...a: unknown[]) => mockReportCachedTokens(...(a as [])),
  reportCacheWriteTokens: (...a: unknown[]) =>
    mockReportCacheWriteTokens(...(a as [])),
  reportUserChatMessage: (...a: unknown[]) =>
    mockReportUserChatMessage(...(a as [])),
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

describe("persistThread — cache-write tokens", () => {
  const SOL_MODEL_ID = "gpt-5.6-sol" as const;
  const solConfig = MODEL_CONFIGS[SOL_MODEL_ID];

  it("bills cache writes at cacheWritePerMillion and pulls them out of plain input", async () => {
    mockUpdateThreadUsage.mockClear();
    mockUpsert.mockResolvedValue({ status: "OK" as const });

    await persistThread({
      threadId: "thread-cw-001",
      modelConfig: solConfig,
      messages: makeMessages(),
      usage: {
        inputTokens: 10_000,
        outputTokens: 500,
        cachedTokens: 6_000,
        cacheWriteTokens: 3_000,
      },
    });

    const pricing = solConfig.pricing;
    // 1_000 uncached + 6_000 cache-read + 3_000 cache-write + 500 output.
    const expectedCost =
      (1_000 / 1_000_000) * pricing.inputPerMillion +
      (6_000 / 1_000_000) * pricing.cachedInputPerMillion +
      (3_000 / 1_000_000) * pricing.cacheWritePerMillion! +
      (500 / 1_000_000) * pricing.outputPerMillion;

    expect(mockUpdateThreadUsage).toHaveBeenCalledWith(
      "thread-cw-001",
      10_000,
      500,
      6_000,
      expectedCost,
    );
  });

  it("keeps write tokens in the uncached-input bucket for a model with no write price (negative)", async () => {
    mockUpdateThreadUsage.mockClear();
    mockUpsert.mockResolvedValue({ status: "OK" as const });

    // gpt-5.4-mini has no cacheWritePerMillion — the provider does not
    // surcharge writes there, so a reported write count must not change cost.
    await persistThread({
      threadId: "thread-cw-002",
      modelConfig,
      messages: makeMessages(),
      usage: {
        inputTokens: 10_000,
        outputTokens: 500,
        cachedTokens: 6_000,
        cacheWriteTokens: 3_000,
      },
    });

    const pricing = modelConfig.pricing;
    const expectedCost =
      (4_000 / 1_000_000) * pricing.inputPerMillion +
      (6_000 / 1_000_000) * pricing.cachedInputPerMillion +
      (500 / 1_000_000) * pricing.outputPerMillion;

    expect(mockUpdateThreadUsage).toHaveBeenCalledWith(
      "thread-cw-002",
      10_000,
      500,
      6_000,
      expectedCost,
    );
  });

  it("emits the cacheWriteTokensUsed metric with the threadId dimension", async () => {
    mockReportCacheWriteTokens.mockClear();
    mockUpsert.mockResolvedValue({ status: "OK" as const });

    await persistThread({
      threadId: "thread-cw-003",
      modelConfig: solConfig,
      messages: makeMessages(),
      usage: {
        inputTokens: 10_000,
        outputTokens: 500,
        cachedTokens: 6_000,
        cacheWriteTokens: 3_000,
      },
    });
    // Metrics are fire-and-forget.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockReportCacheWriteTokens).toHaveBeenCalledWith(3_000, SOL_MODEL_ID, {
      threadId: "thread-cw-003",
    });
  });

  it("reports zero writes rather than skipping the metric when the provider omits them", async () => {
    mockReportCacheWriteTokens.mockClear();
    mockUpsert.mockResolvedValue({ status: "OK" as const });

    await persistThread({ ...BASE_PAYLOAD, messages: makeMessages() });
    await new Promise((r) => setTimeout(r, 0));

    expect(mockReportCacheWriteTokens).toHaveBeenCalledWith(0, MINI_MODEL_ID, {
      threadId: "thread-persist-001",
    });
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
