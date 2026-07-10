import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Build per-test spies that cosmos.ts will use ----
const mockPatch = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockQueryFetchAll = vi.fn();

let lastItemArgs: [string, string] | null = null;
let lastQuerySpec: any = null;
let lastQueryOpts: any = null;

vi.mock("@/features/common/services/cosmos", () => ({
  HistoryContainer: vi.fn(() => ({
    item: (docId: string, pk: string) => {
      lastItemArgs = [docId, pk];
      return { patch: mockPatch, delete: mockDelete };
    },
    items: {
      create: mockCreate,
      query: (q: any, opts: any) => {
        lastQuerySpec = q;
        lastQueryOpts = opts;
        return { fetchAll: mockQueryFetchAll };
      },
    },
  })),
}));

const mockLogError = vi.fn();
vi.mock("@/features/common/services/logger", () => ({
  logError: (...args: any[]) => mockLogError(...args),
}));

const notFound = () => Object.assign(new Error("Not found"), { code: 404 });
const conflict = () => Object.assign(new Error("Conflict"), { code: 409 });

describe("common.unit.agent-stats — RecordAgentChatStarted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastItemArgs = null;
  });

  it("agent-stats.001: patches chatCount incr + lastUsedAt set on the sentinel partition", async () => {
    mockPatch.mockResolvedValueOnce({ resource: {} });
    const { RecordAgentChatStarted } = await import("./agent-stats-service");
    await RecordAgentChatStarted("persona-1");

    expect(lastItemArgs).toEqual(["AGENT_STATS_persona-1", "AGENT_STATS"]);
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const ops = mockPatch.mock.calls[0][0];
    expect(ops).toEqual([
      { op: "incr", path: "/chatCount", value: 1 },
      expect.objectContaining({ op: "set", path: "/lastUsedAt" }),
    ]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("agent-stats.002: on patch 404 creates a seed doc pre-populated with this event", async () => {
    mockPatch.mockRejectedValueOnce(notFound());
    mockCreate.mockResolvedValueOnce({ resource: {} });
    const { RecordAgentChatStarted } = await import("./agent-stats-service");
    await RecordAgentChatStarted("persona-1");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const seed = mockCreate.mock.calls[0][0];
    expect(seed).toMatchObject({
      id: "AGENT_STATS_persona-1",
      userId: "AGENT_STATS",
      type: "AGENT_STATS",
      personaId: "persona-1",
      chatCount: 1,
      messageCount: 0,
    });
    // No second patch needed — the seed carries the increment.
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });

  it("agent-stats.003: on create 409 (lost race) re-patches", async () => {
    mockPatch.mockRejectedValueOnce(notFound());
    mockCreate.mockRejectedValueOnce(conflict());
    mockPatch.mockResolvedValueOnce({ resource: {} });
    const { RecordAgentChatStarted } = await import("./agent-stats-service");
    await RecordAgentChatStarted("persona-1");

    expect(mockPatch).toHaveBeenCalledTimes(2);
  });

  it("agent-stats.004: never throws — unexpected errors are logged", async () => {
    mockPatch.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { code: 500 })
    );
    const { RecordAgentChatStarted } = await import("./agent-stats-service");
    await expect(RecordAgentChatStarted("persona-1")).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalled();
  });
});

describe("common.unit.agent-stats — RecordAgentInteraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastItemArgs = null;
  });

  it("agent-stats.005: patches message + token increments atomically", async () => {
    mockPatch.mockResolvedValueOnce({ resource: {} });
    const { RecordAgentInteraction } = await import("./agent-stats-service");
    await RecordAgentInteraction("persona-2", {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 25,
    });

    expect(lastItemArgs).toEqual(["AGENT_STATS_persona-2", "AGENT_STATS"]);
    const ops = mockPatch.mock.calls[0][0];
    expect(ops).toEqual([
      { op: "incr", path: "/messageCount", value: 1 },
      { op: "incr", path: "/totalInputTokens", value: 100 },
      { op: "incr", path: "/totalOutputTokens", value: 50 },
      { op: "incr", path: "/totalCachedTokens", value: 25 },
      expect.objectContaining({ op: "set", path: "/lastUsedAt" }),
    ]);
  });

  it("agent-stats.006: 404 seed carries the interaction's usage", async () => {
    mockPatch.mockRejectedValueOnce(notFound());
    mockCreate.mockResolvedValueOnce({ resource: {} });
    const { RecordAgentInteraction } = await import("./agent-stats-service");
    await RecordAgentInteraction("persona-2", {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
    });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      personaId: "persona-2",
      chatCount: 0,
      messageCount: 1,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCachedTokens: 0,
    });
  });
});

describe("common.unit.agent-stats — GetAllAgentStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastQuerySpec = null;
    lastQueryOpts = null;
  });

  it("agent-stats.007: single-partition query, returns map keyed by personaId", async () => {
    mockQueryFetchAll.mockResolvedValueOnce({
      resources: [
        { personaId: "a", messageCount: 5 },
        { personaId: "b", messageCount: 9 },
      ],
    });
    const { GetAllAgentStats } = await import("./agent-stats-service");
    const result = await GetAllAgentStats();

    expect(lastQueryOpts).toEqual({ partitionKey: "AGENT_STATS" });
    expect(lastQuerySpec.parameters).toEqual([
      { name: "@type", value: "AGENT_STATS" },
      { name: "@pk", value: "AGENT_STATS" },
    ]);
    expect(Object.keys(result)).toEqual(["a", "b"]);
    expect(result["b"].messageCount).toBe(9);
  });

  it("agent-stats.008: degrades to empty map on query failure", async () => {
    mockQueryFetchAll.mockRejectedValueOnce(new Error("cosmos down"));
    const { GetAllAgentStats } = await import("./agent-stats-service");
    await expect(GetAllAgentStats()).resolves.toEqual({});
    expect(mockLogError).toHaveBeenCalled();
  });
});

describe("common.unit.agent-stats — DeleteAgentStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("agent-stats.009: ignores 404, logs other failures", async () => {
    mockDelete.mockRejectedValueOnce(notFound());
    const { DeleteAgentStats } = await import("./agent-stats-service");
    await expect(DeleteAgentStats("gone")).resolves.toBeUndefined();
    expect(mockLogError).not.toHaveBeenCalled();

    mockDelete.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { code: 500 })
    );
    await expect(DeleteAgentStats("gone")).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});
