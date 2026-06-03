/**
 * Fake AI SDK provider for e2e tests (AZURECHAT_TEST_BACKEND=memory).
 *
 * Returns a hand-rolled LanguageModelV3-compatible object rather than
 * MockLanguageModelV2 from ai/test, because MockLanguageModelV2 carries
 * specificationVersion:'v2' while LanguageModelV3 requires 'v3'. The two
 * are structurally incompatible at the discriminant field.
 *
 * --- Scripting mechanism ---
 * Set process.env.AZURECHAT_E2E_SCRIPT to a JSON-encoded object before
 * the request arrives. Supported shapes:
 *
 *   { kind: "text",     text: "..." }
 *     → streams the given text as plain text deltas, then finishes.
 *
 *   { kind: "reasoning", reasoning: "...", text: "..." }
 *     → streams reasoning deltas, then text deltas.
 *
 *   { kind: "toolCall",  toolName: "...", args: {...}, result: {...}, finalText: "..." }
 *     → emits a full tool-input sequence, then a text reply.
 *
 *   { kind: "error", errorMessage: "..." }
 *     → the stream emits an error part; doGenerate throws.
 *
 * If the env var is absent or empty the default reply is used:
 *   "TEST: this is a stubbed assistant reply for e2e."
 *
 * NOTE: page.route()-level HTTP interception remains the recommended
 * pattern for spec authors who need per-test control without restarting
 * the Next.js dev server. The env-var mechanism is provided for cases
 * where deep pipeline hooks make HTTP-level mocking impractical.
 */

import type { AiProviderFn } from "../../features/chat-page/chat-services/models/provider";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_REPLY = "TEST: this is a stubbed assistant reply for e2e.";

type E2eScript =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; reasoning: string; text: string }
  | {
      kind: "toolCall";
      toolName: string;
      args: Record<string, unknown>;
      result: Record<string, unknown>;
      finalText: string;
    }
  | {
      // Composite: reasoning + tool call + final text in a single response.
      // Lets persistence-round-trip + multi-turn-tool-loop be expressed
      // without juggling multiple per-request scripts.
      kind: "complex";
      reasoning?: string;
      toolCalls?: Array<{
        toolName: string;
        args: Record<string, unknown>;
        result: Record<string, unknown>;
      }>;
      finalText: string;
    }
  | { kind: "error"; errorMessage: string };

function readScript(): E2eScript | null {
  const raw = process.env.AZURECHAT_E2E_SCRIPT;
  if (!raw) return null;
  try {
    const script = JSON.parse(raw) as E2eScript;
    // Single-shot: clear the env var on every read. This guarantees:
    //   1. Tests can't leak script state into each other (Playwright
    //      workers=1 means tests share this process; without clearing,
    //      the next test inherits the previous test's leftover).
    //   2. If the AI SDK loops on tool-call iterations (rare when we
    //      emit inline tool-results, but possible), iteration 2+
    //      gets DEFAULT_REPLY which won't request another tool — the
    //      loop ends. The user-visible text becomes scripted-finalText
    //      followed by DEFAULT_REPLY appended; tests assert on the
    //      scripted substring which is still present.
    delete process.env.AZURECHAT_E2E_SCRIPT;
    return script;
  } catch {
    return null;
  }
}

function makeUsage() {
  return {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
}

function makeFinishReason(unified: "stop" | "tool-calls" | "error" = "stop") {
  return { unified, raw: unified };
}

// Build a ReadableStream from an array of LanguageModelV3StreamPart objects.
// text-delta and reasoning-delta parts are paced so the client paints
// intermediate streaming frames: abort-mid-stream specs need time to click
// the stop button, and the reasoning panel needs a "reasoning is the last
// part" frame to open before the answer arrives (otherwise React coalesces
// the whole stream into one render and the panel never opens). Other part
// types flush immediately so the test runtime stays bounded.
const PACED_PART_TYPES = new Set(["text-delta", "reasoning-delta"]);
function chunkStream(parts: unknown[]): ReadableStream<unknown> {
  return new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
        if (
          typeof part === "object" &&
          part !== null &&
          PACED_PART_TYPES.has((part as { type?: string }).type ?? "")
        ) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      controller.close();
    },
  });
}

// Split text into word-boundary deltas matching openai.ts behaviour.
function textDeltas(id: string, text: string): unknown[] {
  const parts: unknown[] = [];
  parts.push({ type: "stream-start", warnings: [] });
  parts.push({ type: "text-start", id });
  for (const segment of text.split(/(\s+)/)) {
    if (segment.length === 0) continue;
    parts.push({ type: "text-delta", id, delta: segment });
  }
  parts.push({ type: "text-end", id });
  parts.push({
    type: "finish",
    usage: makeUsage(),
    finishReason: makeFinishReason("stop"),
  });
  return parts;
}

function buildStream(): ReadableStream<unknown> {
  const script = readScript();

  if (!script) {
    return chunkStream(textDeltas("txt-0", DEFAULT_REPLY));
  }

  switch (script.kind) {
    case "text": {
      return chunkStream(textDeltas("txt-0", script.text));
    }

    case "reasoning": {
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      parts.push({ type: "reasoning-start", id: "rsn-0" });
      for (const seg of script.reasoning.split(/(\s+)/)) {
        if (seg.length === 0) continue;
        parts.push({ type: "reasoning-delta", id: "rsn-0", delta: seg });
      }
      parts.push({ type: "reasoning-end", id: "rsn-0" });
      parts.push({ type: "text-start", id: "txt-0" });
      for (const seg of script.text.split(/(\s+)/)) {
        if (seg.length === 0) continue;
        parts.push({ type: "text-delta", id: "txt-0", delta: seg });
      }
      parts.push({ type: "text-end", id: "txt-0" });
      parts.push({
        type: "finish",
        usage: makeUsage(),
        finishReason: makeFinishReason("stop"),
      });
      return chunkStream(parts);
    }

    case "toolCall": {
      const inputJson = JSON.stringify(script.args);
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      parts.push({
        type: "tool-input-start",
        id: "tc-0",
        toolName: script.toolName,
      });
      // Stream the JSON input in one delta for simplicity.
      parts.push({ type: "tool-input-delta", id: "tc-0", delta: inputJson });
      parts.push({ type: "tool-input-end", id: "tc-0" });
      // Emit the full tool-call content part.
      parts.push({
        type: "tool-call",
        toolCallId: "tc-0",
        toolName: script.toolName,
        input: inputJson,
      });
      // Emit the tool result inline so the AI SDK does not need to
      // execute() the tool itself. The route's `tools` registry may not
      // contain the script's tool name (the test isn't using a real
      // registered tool — it's just verifying the rendering pipeline);
      // without a server-side execute, the AI SDK would otherwise leave
      // the tool-call part with no `output` and the expanded widget
      // would render empty. providerExecuted=true tells the SDK this
      // result came from the provider, not local execute.
      parts.push({
        type: "tool-result",
        toolCallId: "tc-0",
        toolName: script.toolName,
        result: script.result,
        providerExecuted: true,
      });
      // Text reply after tool call.
      parts.push({ type: "text-start", id: "txt-0" });
      for (const seg of script.finalText.split(/(\s+)/)) {
        if (seg.length === 0) continue;
        parts.push({ type: "text-delta", id: "txt-0", delta: seg });
      }
      parts.push({ type: "text-end", id: "txt-0" });
      parts.push({
        type: "finish",
        usage: makeUsage(),
        finishReason: makeFinishReason("tool-calls"),
      });
      return chunkStream(parts);
    }

    case "error": {
      const parts: unknown[] = [
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error(script.errorMessage) },
        {
          type: "finish",
          usage: makeUsage(),
          finishReason: makeFinishReason("error"),
        },
      ];
      return chunkStream(parts);
    }

    case "complex": {
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (script.reasoning) {
        parts.push({ type: "reasoning-start", id: "rsn-0" });
        for (const seg of script.reasoning.split(/(\s+)/)) {
          if (seg.length === 0) continue;
          parts.push({ type: "reasoning-delta", id: "rsn-0", delta: seg });
        }
        parts.push({ type: "reasoning-end", id: "rsn-0" });
      }
      for (const [i, tc] of (script.toolCalls ?? []).entries()) {
        const tcId = `tc-${i}`;
        const inputJson = JSON.stringify(tc.args);
        parts.push({ type: "tool-input-start", id: tcId, toolName: tc.toolName });
        parts.push({ type: "tool-input-delta", id: tcId, delta: inputJson });
        parts.push({ type: "tool-input-end", id: tcId });
        parts.push({
          type: "tool-call",
          toolCallId: tcId,
          toolName: tc.toolName,
          input: inputJson,
        });
        // Provider-executed result so AI SDK skips local execute (see
        // toolCall case for rationale).
        parts.push({
          type: "tool-result",
          toolCallId: tcId,
          toolName: tc.toolName,
          result: tc.result,
          providerExecuted: true,
        });
      }
      parts.push({ type: "text-start", id: "txt-0" });
      for (const seg of script.finalText.split(/(\s+)/)) {
        if (seg.length === 0) continue;
        parts.push({ type: "text-delta", id: "txt-0", delta: seg });
      }
      parts.push({ type: "text-end", id: "txt-0" });
      parts.push({
        type: "finish",
        usage: makeUsage(),
        finishReason: makeFinishReason(
          (script.toolCalls?.length ?? 0) > 0 ? "tool-calls" : "stop",
        ),
      });
      return chunkStream(parts);
    }

    default: {
      return chunkStream(textDeltas("txt-0", DEFAULT_REPLY));
    }
  }
}

function buildGenerateResult() {
  const script = readScript();

  if (!script) {
    return {
      content: [{ type: "text" as const, text: DEFAULT_REPLY }],
      finishReason: makeFinishReason("stop"),
      usage: makeUsage(),
      warnings: [],
    };
  }

  if (script.kind === "error") {
    throw new Error(script.errorMessage);
  }

  if (script.kind === "reasoning") {
    return {
      content: [
        { type: "reasoning" as const, text: script.reasoning },
        { type: "text" as const, text: script.text },
      ],
      finishReason: makeFinishReason("stop"),
      usage: makeUsage(),
      warnings: [],
    };
  }

  if (script.kind === "toolCall") {
    return {
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "tc-0",
          toolName: script.toolName,
          input: JSON.stringify(script.args),
        },
        { type: "text" as const, text: script.finalText },
      ],
      finishReason: makeFinishReason("tool-calls"),
      usage: makeUsage(),
      warnings: [],
    };
  }

  // text
  return {
    content: [{ type: "text" as const, text: script.text }],
    finishReason: makeFinishReason("stop"),
    usage: makeUsage(),
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Fake model implementation
// ---------------------------------------------------------------------------

/**
 * A minimal LanguageModelV3-compatible object.
 *
 * The `as unknown as ReturnType<AiProviderFn>` cast in the factory is
 * required because the top-level @ai-sdk/provider package installed at
 * node_modules/@ai-sdk/provider is v2.0.0 and does not export LanguageModelV3
 * (pre-existing tsc error in provider.ts). At runtime the object is
 * structurally compatible: specificationVersion:'v3', doStream, doGenerate.
 */
function makeFakeModel(deploymentName: string): unknown {
  return {
    specificationVersion: "v3" as const,
    provider: "fake-azure",
    modelId: deploymentName,
    supportedUrls: {},

    async doGenerate(_options: unknown) {
      return buildGenerateResult();
    },

    async doStream(_options: unknown) {
      return { stream: buildStream() };
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns an AiProviderFn that maps any deploymentName to a deterministic
 * fake LanguageModelV3.
 */
export function createFakeAzureProvider(): AiProviderFn {
  return (deploymentName: string) =>
    makeFakeModel(deploymentName) as ReturnType<AiProviderFn>;
}
