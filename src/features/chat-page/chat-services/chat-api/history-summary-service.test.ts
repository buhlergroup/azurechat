import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// No model is ever reached from this file: `recordHistoryCompaction` takes the
// summariser as a parameter and every test injects its own.

// ── Cosmos ────────────────────────────────────────────────────────────────────
let stored: any[] = [];
const upsert = vi.fn(async (doc: any) => {
  stored = [...stored.filter((d) => d.id !== doc.id), doc];
  return { resource: doc };
});
const query = vi.fn(() => ({
  fetchAll: async () => ({
    resources: stored.filter((d) => d.type === "CHAT_HISTORY_SUMMARY" && !d.isDeleted),
  }),
}));
vi.mock("@/features/common/services/cosmos", () => ({
  HistoryContainer: () => ({ items: { upsert, query } }),
}));

// ── Auth ──────────────────────────────────────────────────────────────────────
vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "user-hash"),
}));

// ── Logger ────────────────────────────────────────────────────────────────────
const logWarn = vi.fn();
const logError = vi.fn();
vi.mock("@/features/common/services/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: (...a: unknown[]) => logWarn(...a),
  logError: (...a: unknown[]) => logError(...a),
}));

// ── Model table ───────────────────────────────────────────────────────────────
// MODEL_CONFIGS reads the deployment-name env vars at MODULE LOAD, which in a
// test means before any `process.env` assignment in a test body. A small fixed
// table keeps the deployment resolution deterministic and states which seam
// each model is on, which is the part that matters here.
vi.mock("../models", () => ({
  MODEL_CONFIGS: {
    "gpt-5.6-sol": { id: "gpt-5.6-sol", deploymentName: "sol-dep" },
    "gpt-5.6-luna": { id: "gpt-5.6-luna", deploymentName: "luna-dep" },
    "claude-sonnet-5": {
      id: "claude-sonnet-5",
      provider: "anthropic",
      deploymentName: "claude-dep",
    },
    "DeepSeek-V4-Pro": {
      id: "DeepSeek-V4-Pro",
      provider: "foundry",
      deploymentName: "deepseek-dep",
    },
  },
}));

// ── OpenAI clients (never called; the summariser is always injected) ─────────
vi.mock("@/features/common/services/openai", () => ({
  OpenAIV1Instance: () => {
    throw new Error("no live model calls in unit tests");
  },
  OpenAIMiniInstance: () => {
    throw new Error("no live model calls in unit tests");
  },
}));

import {
  DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS,
  FindChatHistorySummary,
  SoftDeleteChatHistorySummary,
  isHistorySummaryEnabled,
  recordHistoryCompaction,
  resolveHistorySummaryDeployment,
  resolveHistorySummaryTimeoutMs,
} from "./history-summary-service";
import { HISTORY_SUMMARY_ATTRIBUTE } from "./history-summary";
import type { BudgetMessage } from "./history-budget";

const ENV_KEYS = [
  "HISTORY_SUMMARY_ENABLED",
  "HISTORY_SUMMARY_DEPLOYMENT_NAME",
  "HISTORY_SUMMARY_TIMEOUT_MS",
  "AZURE_OPENAI_API_GPT56_TERRA_DEPLOYMENT_NAME",
  "AZURE_OPENAI_API_GPT56_LUNA_DEPLOYMENT_NAME",
  "AZURE_OPENAI_API_GPT56_SOL_DEPLOYMENT_NAME",
  "AZURE_OPENAI_API_MINI_DEPLOYMENT_NAME",
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  stored = [];
  vi.clearAllMocks();
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.AZURE_OPENAI_API_GPT56_TERRA_DEPLOYMENT_NAME = "terra-dep";
  process.env.AZURE_OPENAI_API_GPT56_LUNA_DEPLOYMENT_NAME = "luna-dep";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const dropped: BudgetMessage[] = [
  { id: "m1", role: "user", content: "Always answer in metric units." },
  { id: "m2", role: "assistant", content: "Noted." },
];

function summariserReturning(text: string) {
  return vi.fn(async () => text);
}

// ---------------------------------------------------------------------------

describe("chat-page.unit.history-summary-service.001 — configuration", () => {
  it("is off unless the flag is exactly \"true\"", () => {
    for (const value of [undefined, "", "false", "1", "TRUE", "yes"]) {
      if (value === undefined) delete process.env.HISTORY_SUMMARY_ENABLED;
      else process.env.HISTORY_SUMMARY_ENABLED = value;
      expect(isHistorySummaryEnabled()).toBe(false);
    }
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    expect(isHistorySummaryEnabled()).toBe(true);
  });

  it("summarises on the thread's own model", () => {
    // The dropped block is the block that model just had in context. Sending
    // it to another deployment pays for every one of those tokens again,
    // cold, on a deployment that has never seen them.
    process.env.AZURE_OPENAI_API_GPT56_SOL_DEPLOYMENT_NAME = "sol-dep";
    expect(
      resolveHistorySummaryDeployment({ selectedModel: "gpt-5.6-sol" }),
    ).toBe("sol-dep");
    expect(
      resolveHistorySummaryDeployment({ selectedModel: "gpt-5.6-luna" }),
    ).toBe("luna-dep");
  });

  it("lets the explicit override beat even the thread's model", () => {
    process.env.HISTORY_SUMMARY_DEPLOYMENT_NAME = "explicit-dep";
    expect(
      resolveHistorySummaryDeployment({ selectedModel: "gpt-5.6-luna" }),
    ).toBe("explicit-dep");
  });

  it("falls back to terra for a model this client cannot call", () => {
    // callSummariserModel speaks Azure OpenAI Chat Completions. A Claude or
    // Foundry thread has a deployment name it cannot call, and a 404 on every
    // trim would be worse than summarising elsewhere.
    for (const selectedModel of ["claude-sonnet-5", "DeepSeek-V4-Pro"]) {
      expect(resolveHistorySummaryDeployment({ selectedModel })).toBe(
        "terra-dep",
      );
    }
    // Same for an id that is not in the table at all.
    expect(resolveHistorySummaryDeployment({ selectedModel: "gpt-9000" })).toBe(
      "terra-dep",
    );
  });

  it("defaults to terra, then luna, then the titles deployment", () => {
    expect(resolveHistorySummaryDeployment()).toBe("terra-dep");
    delete process.env.AZURE_OPENAI_API_GPT56_TERRA_DEPLOYMENT_NAME;
    expect(resolveHistorySummaryDeployment()).toBe("luna-dep");
    delete process.env.AZURE_OPENAI_API_GPT56_LUNA_DEPLOYMENT_NAME;
    process.env.AZURE_OPENAI_API_MINI_DEPLOYMENT_NAME = "mini-dep";
    expect(resolveHistorySummaryDeployment()).toBe("mini-dep");
  });

  it("resolves to undefined when nothing is configured", () => {
    delete process.env.AZURE_OPENAI_API_GPT56_TERRA_DEPLOYMENT_NAME;
    delete process.env.AZURE_OPENAI_API_GPT56_LUNA_DEPLOYMENT_NAME;
    expect(resolveHistorySummaryDeployment()).toBeUndefined();
  });
});

describe("chat-page.unit.history-summary-service.002 — recordHistoryCompaction writes the watermark", () => {
  it("persists the row with the summary when the feature is on", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    const summarise = summariserReturning("FACTS: metric units.");

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise,
    });

    expect(summarise).toHaveBeenCalledTimes(1);
    expect(row).not.toBeNull();
    expect(row!.type).toBe(HISTORY_SUMMARY_ATTRIBUTE);
    expect(row!.content).toBe("FACTS: metric units.");
    expect(row!.coversThroughMessageId).toBe("m2");
    expect(row!.coversMessageCount).toBe(2);
    expect(row!.model).toBe("terra-dep");
    expect(row!.estimatedTokens).toBeGreaterThan(0);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("writes the watermark with an EMPTY summary when the feature is off", async () => {
    // The watermark is what stops a trim from sliding forward one turn at a
    // time, so it has to be persisted regardless of the feature flag.
    const summarise = summariserReturning("should not be used");

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise,
    });

    expect(summarise).not.toHaveBeenCalled();
    expect(row!.content).toBe("");
    expect(row!.model).toBe("");
    expect(row!.estimatedTokens).toBe(0);
    expect(row!.coversThroughMessageId).toBe("m2");
  });

  it("makes the row readable back through FindChatHistorySummary", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("body"),
    });

    const found = await FindChatHistorySummary("t1");
    expect(found?.content).toBe("body");
    expect(found?.coversThroughMessageId).toBe("m2");
  });

  it("upserts in place, so a thread never accumulates summary rows", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    const first = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("first"),
    });
    const second = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: [{ id: "m3", role: "user", content: "more" }],
      coversThroughMessageId: "m3",
      previous: first,
      summarise: summariserReturning("second"),
    });

    expect(second!.id).toBe(first!.id);
    expect(stored.filter((d) => d.type === HISTORY_SUMMARY_ATTRIBUTE)).toHaveLength(1);
    expect(second!.coversThroughMessageId).toBe("m3");
    // coversMessageCount is cumulative across trims.
    expect(second!.coversMessageCount).toBe(3);
  });

  it("returns null when even the watermark cannot be written", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    upsert.mockRejectedValueOnce(new Error("cosmos down"));

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("body"),
    });

    expect(row).toBeNull();
    expect(logError).toHaveBeenCalled();
  });

  it("does not call the summariser for an empty block", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    const summarise = summariserReturning("body");
    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: [],
      coversThroughMessageId: "m0",
      summarise,
    });
    expect(summarise).not.toHaveBeenCalled();
    expect(row!.content).toBe("");
  });
});

describe("chat-page.unit.history-summary-service.003 — the previous summary is folded in", () => {
  it("passes the previous summary to the summariser and replaces it", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    const first = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("FACTS: metric units."),
    });

    const summarise = vi.fn(async () => "FACTS: metric units. DECISIONS: ship Friday.");
    const second = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: [{ id: "m4", role: "user", content: "Ship on Friday." }],
      coversThroughMessageId: "m4",
      previous: first,
      summarise,
    });

    const [call] = summarise.mock.calls as unknown as [
      [{ userPrompt: string; systemPrompt: string; deployment: string }],
    ];
    expect(call[0].userPrompt).toContain("<prior-summary>");
    expect(call[0].userPrompt).toContain("FACTS: metric units.");
    expect(call[0].deployment).toBe("terra-dep");
    expect(second!.content).toContain("DECISIONS: ship Friday.");
  });

  it("keeps the previous summary when the feature is switched off mid-thread", async () => {
    const previous = {
      id: "summary-t1",
      type: HISTORY_SUMMARY_ATTRIBUTE as typeof HISTORY_SUMMARY_ATTRIBUTE,
      threadId: "t1",
      userId: "user-hash",
      isDeleted: false,
      createdAt: new Date("2026-09-01"),
      role: "system" as const,
      kind: "summary" as const,
      content: "FACTS: earned earlier.",
      coversThroughMessageId: "m2",
      coversMessageCount: 2,
      model: "luna-dep",
      estimatedTokens: 6,
    };

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m9",
      previous,
    });

    // Context already paid for is not thrown away just because the flag moved.
    expect(row!.content).toBe("FACTS: earned earlier.");
    expect(row!.coversThroughMessageId).toBe("m9");
  });
});

describe("chat-page.unit.history-summary-service.004 — fallback when the summariser fails", () => {
  it("still advances the watermark when the summariser throws", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    const summarise = vi.fn(async () => {
      throw new Error("429 rate limited");
    });

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise,
    });

    // Plain trimming: the block is gone, the watermark holds, no summary.
    expect(row).not.toBeNull();
    expect(row!.content).toBe("");
    expect(row!.coversThroughMessageId).toBe("m2");
    expect(logWarn).toHaveBeenCalled();
    const warned = logWarn.mock.calls.map((c) => String(c[0])).join(" | ");
    expect(warned).toContain("falling back to plain trimming");
  });

  it("keeps an earlier summary when a later summariser call throws", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    const first = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("FACTS: metric units."),
    });

    const second = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: [{ id: "m5", role: "user", content: "next" }],
      coversThroughMessageId: "m5",
      previous: first,
      summarise: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    // The old summary still correctly describes everything before this block,
    // so only the newly dropped block is lost.
    expect(second!.content).toBe("FACTS: metric units.");
    expect(second!.coversThroughMessageId).toBe("m5");
  });

  it("falls back when the summariser returns only whitespace", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("   \n  "),
    });
    expect(row!.content).toBe("");
    expect(logWarn).toHaveBeenCalled();
  });

  it("falls back when no deployment is configured", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    // Every candidate gone: terra, luna and the titles deployment.
    delete process.env.AZURE_OPENAI_API_GPT56_TERRA_DEPLOYMENT_NAME;
    delete process.env.AZURE_OPENAI_API_GPT56_LUNA_DEPLOYMENT_NAME;
    const summarise = summariserReturning("body");

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise,
    });

    expect(summarise).not.toHaveBeenCalled();
    expect(row!.content).toBe("");
    expect(row!.coversThroughMessageId).toBe("m2");
  });
});

describe("chat-page.unit.history-summary-service.005 — read and invalidate", () => {
  it("returns null when the thread has no compaction row", async () => {
    expect(await FindChatHistorySummary("t1")).toBeNull();
  });

  it("returns null rather than throwing when Cosmos fails", async () => {
    query.mockImplementationOnce(() => ({
      fetchAll: async () => {
        throw new Error("cosmos down");
      },
    }));
    expect(await FindChatHistorySummary("t1")).toBeNull();
    expect(logWarn).toHaveBeenCalled();
  });

  it("soft-deletes the row so a rewound thread stops replaying it", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("body"),
    });
    expect(await FindChatHistorySummary("t1")).not.toBeNull();

    await SoftDeleteChatHistorySummary("t1");

    // Both the summary text AND the watermark go, so the budget re-derives a
    // cut from whatever survived the rewind.
    expect(await FindChatHistorySummary("t1")).toBeNull();
  });

  it("is a no-op when there is nothing to soft-delete", async () => {
    await SoftDeleteChatHistorySummary("t1");
    expect(upsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("chat-page.unit.history-summary-service.006 — the summariser has a deadline", () => {
  it("resolves the timeout from the env, ignoring nonsense", () => {
    // A typo must not become "give up immediately", and must not become
    // "wait forever" either.
    expect(resolveHistorySummaryTimeoutMs(undefined)).toBe(
      DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS,
    );
    expect(resolveHistorySummaryTimeoutMs("")).toBe(DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS);
    expect(resolveHistorySummaryTimeoutMs("nope")).toBe(
      DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS,
    );
    expect(resolveHistorySummaryTimeoutMs("0")).toBe(DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS);
    expect(resolveHistorySummaryTimeoutMs("-5000")).toBe(
      DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS,
    );
    expect(resolveHistorySummaryTimeoutMs("5000")).toBe(5000);
    expect(resolveHistorySummaryTimeoutMs("5000.9")).toBe(5000);
  });

  it("defaults to 20 seconds", () => {
    expect(DEFAULT_HISTORY_SUMMARY_TIMEOUT_MS).toBe(20_000);
  });

  it("falls back to the plain trim when the summariser hangs", async () => {
    // This call is on the REQUEST path — it runs before the stream starts, so
    // a hanging deployment would otherwise stall the turn with no ceiling.
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    process.env.HISTORY_SUMMARY_TIMEOUT_MS = "25";

    let settle: (() => void) | undefined;
    const hangs = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          // Never resolves on its own; kept addressable so the test can free
          // it rather than leaving a dangling promise behind.
          settle = () => resolve("too late");
        }),
    );

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: hangs,
    });

    // The trim STILL STICKS: the watermark is the thing that makes the prompt
    // cheap, and it is written whether or not there is a summary to go with it.
    expect(row).not.toBeNull();
    expect(row!.content).toBe("");
    expect(row!.coversThroughMessageId).toBe("m2");
    expect(row!.model).toBe("");

    const warned = logWarn.mock.calls.map((c) => String(c[0])).join(" | ");
    expect(warned).toContain("timed out");
    expect(warned).toContain("falling back to plain trimming");
    // The payload has to say it was a timeout, not just that something failed.
    const timeoutCall = logWarn.mock.calls.find((c) =>
      String(c[0]).includes("timed out"),
    );
    expect((timeoutCall?.[1] as { timedOut?: boolean })?.timedOut).toBe(true);
    expect((timeoutCall?.[1] as { timeoutMs?: number })?.timeoutMs).toBe(25);

    settle?.();
  });

  it("aborts the signal it handed the summariser, rather than abandoning the call", async () => {
    // An abandoned HTTP call keeps spending on a result nobody will read.
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    process.env.HISTORY_SUMMARY_TIMEOUT_MS = "25";

    let seenSignal: AbortSignal | undefined;
    const hangs = vi.fn(
      (input: { signal?: AbortSignal }) =>
        new Promise<string>(() => {
          seenSignal = input.signal;
        }),
    );

    await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: hangs,
    });

    expect(seenSignal).toBeDefined();
    expect(seenSignal!.aborted).toBe(true);
  });

  it("does not interfere with a summariser that answers in time", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    process.env.HISTORY_SUMMARY_TIMEOUT_MS = "5000";

    const row = await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      summarise: summariserReturning("FACTS: metric units."),
    });

    expect(row!.content).toBe("FACTS: metric units.");
    expect(row!.model).toBe("terra-dep");
    const warned = logWarn.mock.calls.map((c) => String(c[0])).join(" | ");
    expect(warned).not.toContain("timed out");
  });
});

describe("chat-page.unit.history-summary-service.006 — the summariser is not billed to the user", () => {
  it("reports no usage: no metrics service, no budget service", async () => {
    // The user did not ask for this call; the budget did, to make their thread
    // cheaper. Charging their daily cap or their visible usage figure for our
    // own housekeeping would be wrong, so this module must not reach either
    // service. Asserted on the source because the invariant is an ABSENCE —
    // there is no call to spy on.
    const [{ readFile }, path] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const source = await readFile(
      path.join(process.cwd(), "features/chat-page/chat-services/chat-api/history-summary-service.ts"),
      "utf-8",
    );
    expect(source).not.toContain("chat-metrics");
    expect(source).not.toContain("budget-service");
    expect(source).not.toContain("reportPromptTokens");
    expect(source).not.toContain("recordUsage");
  });

  it("passes the thread's model through from the compaction record", async () => {
    process.env.HISTORY_SUMMARY_ENABLED = "true";
    process.env.AZURE_OPENAI_API_GPT56_SOL_DEPLOYMENT_NAME = "sol-dep";
    const summarise = summariserReturning("FACTS: on the thread's model.");

    await recordHistoryCompaction({
      threadId: "t1",
      userId: "user-hash",
      droppedMessages: dropped,
      coversThroughMessageId: "m2",
      selectedModel: "gpt-5.6-sol",
      summarise,
    });

    const [call] = summarise.mock.calls as unknown as [
      [{ deployment: string }],
    ];
    expect(call[0].deployment).toBe("sol-dep");
  });
});
