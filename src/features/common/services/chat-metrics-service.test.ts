import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist OpenTelemetry meter mocks
const { mockRecord, mockAdd, mockCreateHistogram, mockCreateCounter, mockGetMeter } = vi.hoisted(() => {
  const mockRecord = vi.fn();
  const mockAdd = vi.fn();
  const mockCreateHistogram = vi.fn(() => ({ record: mockRecord }));
  const mockCreateCounter = vi.fn(() => ({ add: mockAdd }));
  const mockGetMeter = vi.fn(() => ({
    createHistogram: mockCreateHistogram,
    createCounter: mockCreateCounter,
  }));
  return { mockRecord, mockAdd, mockCreateHistogram, mockCreateCounter, mockGetMeter };
});

vi.mock("@opentelemetry/api", () => ({
  metrics: { getMeter: mockGetMeter },
}));

vi.mock("@/features/auth-page/helpers", () => ({
  userSession: vi.fn(async () => ({ email: "user@example.com", name: "Test User" })),
  userHashedId: vi.fn(async () => "hashed-id-abc123"),
}));

describe("common.unit.chat-metrics — reportPromptTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("common.unit.chat-metrics.001: creates histogram and records token count with attributes", async () => {
    const { reportPromptTokens } = await import("./chat-metrics-service");
    await reportPromptTokens(100, "gpt-4", "user");
    expect(mockGetMeter).toHaveBeenCalledWith("chat");
    expect(mockCreateHistogram).toHaveBeenCalledWith("promptTokensUsed", expect.any(Object));
    expect(mockRecord).toHaveBeenCalledWith(
      100,
      expect.objectContaining({
        email: "user@example.com",
        chatModel: "gpt-4",
        role: "user",
      })
    );
  });

  it("common.unit.chat-metrics.002: merges extra attributes with defaults", async () => {
    const { reportPromptTokens } = await import("./chat-metrics-service");
    await reportPromptTokens(50, "gpt-4", "assistant", { requestId: "req-1" });
    expect(mockRecord).toHaveBeenCalledWith(
      50,
      expect.objectContaining({ requestId: "req-1", role: "assistant" })
    );
  });
});

describe("common.unit.chat-metrics — reportCompletionTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("common.unit.chat-metrics.003: creates completions histogram and records with default attributes", async () => {
    const { reportCompletionTokens } = await import("./chat-metrics-service");
    await reportCompletionTokens(200, "gpt-4");
    expect(mockCreateHistogram).toHaveBeenCalledWith("completionsTokensUsed", expect.any(Object));
    expect(mockRecord).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ email: "user@example.com", chatModel: "gpt-4" })
    );
  });

  it("common.unit.chat-metrics.004: merges extra attributes for completion tokens", async () => {
    const { reportCompletionTokens } = await import("./chat-metrics-service");
    await reportCompletionTokens(75, "gpt-4", { conversationId: "conv-42" });
    expect(mockRecord).toHaveBeenCalledWith(
      75,
      expect.objectContaining({ conversationId: "conv-42" })
    );
  });
});

describe("common.unit.chat-metrics — reportCachedTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("common.unit.chat-metrics.007: creates cachedTokensUsed histogram and records with default attributes", async () => {
    const { reportCachedTokens } = await import("./chat-metrics-service");
    await reportCachedTokens(200, "gpt-4");
    expect(mockCreateHistogram).toHaveBeenCalledWith("cachedTokensUsed", expect.any(Object));
    expect(mockRecord).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ email: "user@example.com", chatModel: "gpt-4" })
    );
  });

  it("common.unit.chat-metrics.008: merges extra attributes for cached tokens", async () => {
    const { reportCachedTokens } = await import("./chat-metrics-service");
    await reportCachedTokens(64, "gpt-4", { threadId: "thread-9" });
    expect(mockRecord).toHaveBeenCalledWith(
      64,
      expect.objectContaining({ threadId: "thread-9" })
    );
  });
});

describe("common.unit.chat-metrics — reportUserChatMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("common.unit.chat-metrics.005: creates counter and adds 1 with default attributes", async () => {
    const { reportUserChatMessage } = await import("./chat-metrics-service");
    await reportUserChatMessage("gpt-4");
    expect(mockCreateCounter).toHaveBeenCalledWith("userChatMessage", expect.any(Object));
    expect(mockAdd).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ email: "user@example.com", chatModel: "gpt-4" })
    );
  });

  it("common.unit.chat-metrics.006: merges extra attributes for user chat message", async () => {
    const { reportUserChatMessage } = await import("./chat-metrics-service");
    await reportUserChatMessage("gpt-4", { sessionId: "ses-1" });
    expect(mockAdd).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ sessionId: "ses-1" })
    );
  });
});
