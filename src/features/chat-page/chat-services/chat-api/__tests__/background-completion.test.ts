/**
 * Exercises the core invariant of the /api/chat route:
 *
 *   streamText.onFinish fires when the LLM finishes — independent of
 *   whether the response stream's consumer is still alive.
 *
 * We control the LLM speed with a hand-rolled LanguageModelV3 mock that
 * waits a configurable delay between deltas, then we never consume the
 * response stream (simulating a client that navigated away). The route's
 * `result.consumeStream()` should drain the source so onFinish runs and
 * persists the assistant message.
 */
import { describe, it, expect, vi } from "vitest";
import { streamText } from "ai";
import {
  buildAssistantUIMessage,
  persistAssistantFromFinishEvent,
} from "../persist-assistant";

// ── stub the chat-message + chat-thread services so persistThread can run ───
const upsertSpy = vi.fn(async () => ({ status: "OK" as const, response: {} }));
vi.mock("../../chat-message-service", () => ({
  UpsertChatMessage: (...args: unknown[]) => upsertSpy(...args),
}));
vi.mock("../../chat-thread-service", () => ({
  UpdateChatThreadUsage: vi.fn(async () => undefined),
}));
vi.mock("@/features/common/services/usage-service", () => ({
  IncrementUsage: vi.fn(async () => undefined),
}));
vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "hash"),
}));
vi.mock("@/features/common/services/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));
// persistThread's atomic-batch path calls HistoryContainer().items.batch();
// unmocked it drives the real Cosmos SDK against the fake test endpoint and its
// retry/backoff exceeds the 5s test timeout. Reject batch so the sequential
// UpsertChatMessage fallback (stubbed above) runs deterministically.
vi.mock("@/features/common/services/cosmos", () => ({
  HistoryContainer: () => ({
    items: { batch: vi.fn(async () => { throw new Error("batch unavailable in test"); }) },
  }),
}));

// A LanguageModelV3 that streams `words` with `delayMs` between each delta.
function makeSlowModel(words: string[], delayMs: number) {
  return {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text", text: words.join("") }],
        finishReason: "stop" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
    async doStream() {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t-0" });
          for (const w of words) {
            await new Promise((r) => setTimeout(r, delayMs));
            controller.enqueue({ type: "text-delta", id: "t-0", delta: w });
          }
          controller.enqueue({ type: "text-end", id: "t-0" });
          controller.enqueue({
            type: "finish",
            usage: {
              inputTokens: { total: 1, noCache: 1 },
              outputTokens: { total: words.length, text: words.length },
            },
            finishReason: { unified: "stop", raw: "stop" },
          });
          controller.close();
        },
      });
      return { stream };
    },
  };
}

describe("streamText.onFinish — background completion", () => {
  it("fires onFinish with the full text even when the response stream is never consumed", async () => {
    const onFinish = vi.fn(async () => undefined);
    const result = streamText({
      // The mock's structural shape satisfies LanguageModelV3 for the
      // public surface streamText reaches in this test.
      model: makeSlowModel(["hello ", "world ", "from ", "background"], 20) as unknown as Parameters<typeof streamText>[0]["model"],
      messages: [{ role: "user", content: "hi" }],
      onFinish,
    });

    // Drain the stream like the route does. We DELIBERATELY never read the
    // response — equivalent to the browser navigating away mid-stream.
    await result.consumeStream();

    expect(onFinish).toHaveBeenCalledTimes(1);
    const event = onFinish.mock.calls[0]![0]!;
    expect(event.text).toBe("hello world from background");
    expect(event.finishReason).toBe("stop");
  });

  it("buildAssistantUIMessage assembles reasoning + text + tool parts in order", () => {
    const msg = buildAssistantUIMessage(
      {
        text: "Final answer.",
        reasoningText: "Let me think...",
        toolResults: [
          {
            toolCallId: "tc-1",
            toolName: "search",
            input: { q: "x" },
            output: { hits: 0 },
            dynamic: true,
          },
        ],
      },
      "msg-fixed",
    );

    expect(msg.id).toBe("msg-fixed");
    expect(msg.role).toBe("assistant");
    const types = msg.parts.map((p) => p.type);
    expect(types).toEqual(["reasoning", "text", "dynamic-tool"]);
  });

  it("persistAssistantFromFinishEvent writes the assistant + tool rows", async () => {
    upsertSpy.mockClear();
    await persistAssistantFromFinishEvent({
      threadId: "thread-1",
      messageId: "msg-A",
      event: {
        text: "Done.",
        reasoningText: undefined,
        toolResults: [
          {
            toolCallId: "tc-1",
            toolName: "search",
            input: { q: "x" },
            output: { hits: 0 },
            dynamic: true,
          },
        ],
        totalUsage: { inputTokens: 5, outputTokens: 2 },
        // The remaining OnFinishEvent fields aren't read by our code path,
        // so we leave them unset; the function's parameter type is
        // OnFinishEvent<TOOLS> for shape inference at the call site.
      } as unknown as Parameters<typeof persistAssistantFromFinishEvent>[0]["event"],
      modelConfig: {
        id: "gpt-test",
        deploymentName: "gpt-test",
        pricing: {
          inputPerMillion: 1,
          cachedInputPerMillion: 0,
          outputPerMillion: 2,
        },
      } as unknown as Parameters<typeof persistAssistantFromFinishEvent>[0]["modelConfig"],
    });

    expect(upsertSpy).toHaveBeenCalledTimes(2);
    const roles = upsertSpy.mock.calls.map((c) => (c[0] as { role?: string }).role);
    expect(roles).toContain("assistant");
    expect(roles.filter((r) => r === "tool" || r === "function")).toHaveLength(1);
  });
});
