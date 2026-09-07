import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Heavy server-only modules ─────────────────────────────────────────────────
vi.mock("server-only", () => ({}));
vi.mock("@/features/common/services/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock("@/features/theme/theme-config", () => ({
  CHAT_DEFAULT_SYSTEM_PROMPT: "You are a helpful assistant.",
}));

// ── Mocked route deps ─────────────────────────────────────────────────────────
const mockLoadThreadContext = vi.fn();
const mockResolveModelAndLimits = vi.fn();
const mockBuildToolset = vi.fn();
const mockPersistAssistant = vi.fn();
const mockResolveAzureModel = vi.fn();
const mockResolveProvider = vi.fn();
const mockFindAllExtensions = vi.fn();

vi.mock("@/features/chat-page/chat-services/chat-api/thread-context", () => ({
  loadThreadContext: (...a: unknown[]) => mockLoadThreadContext(...a),
}));
vi.mock("@/features/chat-page/chat-services/chat-api/model-selection", () => ({
  resolveModelAndLimits: (...a: unknown[]) => mockResolveModelAndLimits(...a),
}));
const mockRepairExtensionToolCall = vi.fn();
vi.mock("@/features/chat-page/chat-services/tools/registry", () => ({
  buildToolset: (...a: unknown[]) => mockBuildToolset(...a),
  repairExtensionToolCall: (...a: unknown[]) => mockRepairExtensionToolCall(...a),
}));
vi.mock("@/features/chat-page/chat-services/chat-api/persist-assistant", () => ({
  persistAssistantFromFinishEvent: (...a: unknown[]) => mockPersistAssistant(...a),
}));
vi.mock("@/features/chat-page/chat-services/models/provider", () => ({
  resolveAzureModel: (...a: unknown[]) => mockResolveAzureModel(...a),
}));
vi.mock("@/features/chat-page/chat-services/models/provider-seam", () => ({
  resolveProvider: (...a: unknown[]) => mockResolveProvider(...a),
  getFileIdsSignature: (ids: string[] | undefined) =>
    !ids || ids.length === 0 ? "" : [...new Set(ids)].sort().join(","),
}));
vi.mock("@/features/extensions-page/extension-services/extension-service", () => ({
  FindAllExtensionForCurrentUserAndIds: (...a: unknown[]) => mockFindAllExtensions(...a),
  FindSecureHeaderValue: vi.fn(async () => ({ status: "ERROR", errors: [] })),
}));

vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "test-user-hash"),
  getCurrentUser: vi.fn(async () => ({
    name: "Test User",
    email: "test@example.com",
    isAdmin: false,
  })),
}));

vi.mock(
  "@/features/chat-page/chat-services/chat-api/rate-limit-subject",
  () => ({
    resolveRateLimitSubject: vi.fn(async () => "user:test-user-hash"),
  }),
);

// Disable rate limit for the existing scenarios; one specific test re-enables it.
process.env.AZURECHAT_RATE_LIMIT_DISABLED = "1";

// ── ai SDK mock: streamText captures onFinish so we can fire it inline ────────
const mockConsumeStream = vi.fn(async () => undefined);
const mockToUIMessageStreamResponse = vi.fn();
let capturedOnFinish: ((event: unknown) => void | Promise<void>) | undefined;

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn((options: { onFinish?: typeof capturedOnFinish }) => {
      capturedOnFinish = options.onFinish;
      return {
        consumeStream: mockConsumeStream,
        toUIMessageStreamResponse: mockToUIMessageStreamResponse,
        totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
      };
    }),
    convertToModelMessages: vi.fn(async () => []),
  };
});

vi.mock("@ai-sdk/azure", () => ({
  azure: {
    tools: {
      codeInterpreter: vi.fn(() => ({})),
      imageGeneration: vi.fn(() => ({})),
      webSearchPreview: vi.fn(() => ({})),
    },
  },
}));

import { POST } from "../route";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CTX = {
  thread: {
    id: "t1",
    selectedModel: "gpt-4o",
    personaMessage: "",
    defaultTools: undefined,
    codeInterpreterContainerId: undefined,
  },
  user: { id: "user-hash", name: "Test User", email: "test@example.com", isAdmin: false },
  history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] }],
  modelHistory: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] }],
  responsesHistory: [],
  documentHint: undefined,
  documentHintPlacement: "none",
  threadDocumentIds: [],
  personaDocumentIds: [],
  defaultTools: undefined,
  extensions: [],
  attachedFiles: [],
};
const MODEL_RESULT = {
  modelConfig: {
    id: "gpt-4o",
    supportsReasoning: false,
    supportsResponsesAPI: true,
    pricing: undefined,
  },
  fallbackInfo: { fellBack: false },
  effectiveReasoningEffort: undefined,
  selectedModel: "gpt-4o",
};

function makeRequest(contentObj: object, imageFields: string[] = []) {
  const fd = new FormData();
  fd.set("content", JSON.stringify(contentObj));
  for (const img of imageFields) fd.append("image-base64", img);
  const headers = new Map<string, string>([
    ["origin", "http://localhost:3000"],
    ["content-length", "1024"],
  ]);
  return {
    url: "http://localhost:3000/api/chat",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    formData: vi.fn().mockResolvedValue(fd),
    signal: new AbortController().signal,
  } as unknown as Request;
}

describe("/api/chat route (AI SDK v6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnFinish = undefined;
    mockLoadThreadContext.mockResolvedValue(CTX);
    mockResolveModelAndLimits.mockResolvedValue(MODEL_RESULT);
    mockBuildToolset.mockResolvedValue({});
    mockPersistAssistant.mockResolvedValue(undefined);
    mockResolveAzureModel.mockReturnValue({});
    mockResolveProvider.mockReturnValue({
      model: {},
      builtInTools: {},
      providerOptions: { openai: { promptCacheKey: "test", store: false } },
    });
    mockFindAllExtensions.mockResolvedValue({ status: "OK", response: [] });
    mockToUIMessageStreamResponse.mockReturnValue(
      new Response("stream", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });

  it("returns 200 text/event-stream and fires persistAssistantFromFinishEvent when streamText.onFinish fires", async () => {
    const req = makeRequest({ message: "hello", id: "t1" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(typeof capturedOnFinish).toBe("function");

    // Simulate the LLM finishing in the background.
    await capturedOnFinish!({
      text: "hi",
      reasoningText: undefined,
      toolResults: [],
      totalUsage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    });

    expect(mockPersistAssistant).toHaveBeenCalledOnce();
    expect(mockPersistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "t1",
        event: expect.objectContaining({ text: "hi" }),
      }),
    );
  });

  it("wires repairExtensionToolCall into streamText's experimental_repairToolCall option", async () => {
    const { streamText } = await import("ai");
    const req = makeRequest({ message: "hello", id: "t1" });
    await POST(req);

    const streamTextMock = streamText as unknown as { mock: { calls: unknown[][] } };
    const options = streamTextMock.mock.calls[0][0] as {
      experimental_repairToolCall?: (...args: unknown[]) => unknown;
    };
    expect(typeof options.experimental_repairToolCall).toBe("function");

    // The wired function is a thin wrapper (module-mock hoisting pattern
    // used throughout this file) — prove it forwards to the real export
    // rather than asserting on function identity.
    await options.experimental_repairToolCall?.("repair-args");
    expect(mockRepairExtensionToolCall).toHaveBeenCalledWith("repair-args");
  });

  it("passes the resolved effective model into resolveProvider (no-regression: effective == selected)", async () => {
    const req = makeRequest({ message: "hello", id: "t1" });
    await POST(req);
    expect(mockResolveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gpt-4o" }),
    );
  });

  it("threads a downgraded model from resolveModelAndLimits into resolveProvider (not the raw payload)", async () => {
    // Simulate a cap/intent downgrade: the selected model differs from the
    // payload/thread model. The provider seam must receive the downgraded id.
    mockResolveModelAndLimits.mockResolvedValue({
      ...MODEL_RESULT,
      modelConfig: { id: "gpt-5.4-mini", supportsReasoning: false, supportsResponsesAPI: true, pricing: undefined },
      selectedModel: "gpt-5.4-mini",
      fallbackInfo: { fellBack: true, reason: "cap", originalModel: "gpt-4o", fallbackModel: "gpt-5.4-mini" },
    });
    const req = makeRequest({ message: "hello", id: "t1", selectedModel: "gpt-4o" });
    await POST(req);
    expect(mockResolveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gpt-5.4-mini" }),
    );
  });

  it("strips built-in tool toggles when the effective model lacks the Responses API (Foundry downgrade)", async () => {
    mockResolveModelAndLimits.mockResolvedValue({
      ...MODEL_RESULT,
      modelConfig: { id: "DeepSeek-V4-Pro", supportsReasoning: false, supportsResponsesAPI: false, pricing: undefined },
      selectedModel: "DeepSeek-V4-Pro",
    });
    const req = makeRequest({
      message: "hello",
      id: "t1",
      webSearchEnabled: true,
      codeInterpreterEnabled: true,
    });
    await POST(req);
    expect(mockResolveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "DeepSeek-V4-Pro",
        toggles: { codeInterpreter: false, imageGeneration: false, webSearch: false },
      }),
    );
  });

  it("returns validation error before calling streamText when image is oversized", async () => {
    const { streamText } = await import("ai");
    const oversized = "data:image/png;base64," + "A".repeat(21 * 1024 * 1024);
    const req = makeRequest({ message: "hi", id: "t1" }, [oversized]);
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(streamText).not.toHaveBeenCalled();
    expect(mockLoadThreadContext).not.toHaveBeenCalled();
  });

  it("returns 401 when loadThreadContext throws with status 401", async () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockLoadThreadContext.mockRejectedValue(err);
    const req = makeRequest({ message: "hi", id: "t1" });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockPersistAssistant).not.toHaveBeenCalled();
  });

  it("returns 403 when Origin does not match host (CSRF defense)", async () => {
    const { streamText } = await import("ai");
    const fd = new FormData();
    fd.set("content", JSON.stringify({ message: "x", id: "t1" }));
    const headers = new Map<string, string>([
      ["origin", "https://evil.example.com"],
      ["content-length", "1024"],
    ]);
    const req = {
      url: "http://localhost:3000/api/chat",
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      formData: vi.fn().mockResolvedValue(fd),
      signal: new AbortController().signal,
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(streamText).not.toHaveBeenCalled();
    expect(mockLoadThreadContext).not.toHaveBeenCalled();
  });

  it("returns 403 when Origin and Referer are both absent", async () => {
    const fd = new FormData();
    fd.set("content", JSON.stringify({ message: "x", id: "t1" }));
    const headers = new Map<string, string>([["content-length", "1024"]]);
    const req = {
      url: "http://localhost:3000/api/chat",
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      formData: vi.fn().mockResolvedValue(fd),
      signal: new AbortController().signal,
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockLoadThreadContext).not.toHaveBeenCalled();
  });

  it("accepts when Referer matches host and Origin is absent", async () => {
    const fd = new FormData();
    fd.set("content", JSON.stringify({ message: "x", id: "t1" }));
    const headers = new Map<string, string>([
      ["referer", "http://localhost:3000/chat/t1"],
      ["content-length", "1024"],
    ]);
    const req = {
      url: "http://localhost:3000/api/chat",
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      formData: vi.fn().mockResolvedValue(fd),
      signal: new AbortController().signal,
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns 413 when content-length exceeds MAX_REQUEST_BYTES", async () => {
    const { streamText } = await import("ai");
    const fd = new FormData();
    fd.set("content", JSON.stringify({ message: "x", id: "t1" }));
    const headers = new Map<string, string>([
      ["origin", "http://localhost:3000"],
      ["content-length", String(100 * 1024 * 1024)], // 100 MB, above 50 MB cap
    ]);
    const req = {
      url: "http://localhost:3000/api/chat",
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      formData: vi.fn().mockResolvedValue(fd),
      signal: new AbortController().signal,
    } as unknown as Request;

    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(streamText).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Regression: AI SDK v6 migration (51118c8) dropped the filter that narrowed
  // FindAllExtensionForCurrentUserAndIds' response down to the thread's
  // configured extensions. That query is deliberately over-broad
  // (isPublished=true OR userId=@userId OR id IN @ids) so it can resolve
  // publisher-owned extensions too — without the filter, every published or
  // user-owned extension the caller has access to (not just the ones wired to
  // this thread/persona) got forwarded into buildToolset. Nested in this
  // describe (not a sibling) so it inherits the beforeEach above, which
  // resets all the route's mocked collaborators between tests.
  // ───────────────────────────────────────────────────────────────────────────
  describe("extension resolution filter", () => {
    function makeExtension(id: string) {
      return {
        id,
        name: `Extension ${id}`,
        description: "d",
        executionSteps: "s",
        headers: [],
        userId: "some-other-user",
        isPublished: true,
        createdAt: new Date(),
        type: "EXTENSION",
        functions: [],
      };
    }

    it("only forwards extensions whose id is in the thread's configured extension list to buildToolset", async () => {
      const configuredExtension = makeExtension("configured-ext");
      // Simulates the over-broad query surfacing extensions the user owns or
      // that are published, but that are NOT configured on this thread.
      const leakedExtension = makeExtension("leaked-ext-not-on-thread");

      mockLoadThreadContext.mockResolvedValue({
        ...CTX,
        extensions: ["configured-ext"],
      });
      mockFindAllExtensions.mockResolvedValue({
        status: "OK",
        response: [configuredExtension, leakedExtension],
      });

      const req = makeRequest({ message: "hello", id: "t1" });
      await POST(req);

      expect(mockFindAllExtensions).toHaveBeenCalledWith(["configured-ext"]);
      expect(mockBuildToolset).toHaveBeenCalledOnce();
      const passedExtensions = mockBuildToolset.mock.calls[0][0].extensions as Array<{
        extension: { id: string };
      }>;
      expect(passedExtensions).toHaveLength(1);
      expect(passedExtensions[0].extension.id).toBe("configured-ext");
      expect(
        passedExtensions.some((e) => e.extension.id === "leaked-ext-not-on-thread")
      ).toBe(false);
    });

    it("forwards no extensions when the thread has none configured, even if FindAllExtensionForCurrentUserAndIds is never called", async () => {
      mockLoadThreadContext.mockResolvedValue({ ...CTX, extensions: [] });

      const req = makeRequest({ message: "hello", id: "t1" });
      await POST(req);

      expect(mockFindAllExtensions).not.toHaveBeenCalled();
      expect(mockBuildToolset).toHaveBeenCalledOnce();
      expect(mockBuildToolset.mock.calls[0][0].extensions).toEqual([]);
    });

    it("resolves multiple configured extensions and drops multiple leaked ones", async () => {
      const configuredA = makeExtension("cfg-a");
      const configuredB = makeExtension("cfg-b");
      const leakedA = makeExtension("leak-a");
      const leakedB = makeExtension("leak-b");

      mockLoadThreadContext.mockResolvedValue({
        ...CTX,
        extensions: ["cfg-a", "cfg-b"],
      });
      mockFindAllExtensions.mockResolvedValue({
        status: "OK",
        response: [leakedA, configuredA, leakedB, configuredB],
      });

      const req = makeRequest({ message: "hello", id: "t1" });
      await POST(req);

      const passedExtensions = mockBuildToolset.mock.calls[0][0].extensions as Array<{
        extension: { id: string };
      }>;
      const passedIds = passedExtensions.map((e) => e.extension.id).sort();
      expect(passedIds).toEqual(["cfg-a", "cfg-b"]);
    });
  });
});
