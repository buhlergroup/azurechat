import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFakeAzureProvider } from "../azure-provider";

// Helper: drain a ReadableStream into an array of chunks.
async function drainStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

describe("createFakeAzureProvider", () => {
  let savedScript: string | undefined;

  beforeEach(() => {
    savedScript = process.env.AZURECHAT_E2E_SCRIPT;
    delete process.env.AZURECHAT_E2E_SCRIPT;
  });

  afterEach(() => {
    if (savedScript === undefined) {
      delete process.env.AZURECHAT_E2E_SCRIPT;
    } else {
      process.env.AZURECHAT_E2E_SCRIPT = savedScript;
    }
  });

  it("returns a model with specificationVersion v3", () => {
    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o") as { specificationVersion: string };
    expect(model.specificationVersion).toBe("v3");
  });

  it("default stream emits the standard TEST reply", async () => {
    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    const { stream } = await (model as any).doStream({});
    const chunks = await drainStream<{ type: string; delta?: string }>(stream);

    const textChunks = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta ?? "");
    const fullText = textChunks.join("");

    expect(fullText).toBe("TEST: this is a stubbed assistant reply for e2e.");

    // The stream must end with a finish part.
    const lastPart = chunks[chunks.length - 1];
    expect(lastPart.type).toBe("finish");
  });

  it("default doGenerate returns the standard TEST reply", async () => {
    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    const result = await (model as any).doGenerate({});
    expect(result.content).toEqual([
      {
        type: "text",
        text: "TEST: this is a stubbed assistant reply for e2e.",
      },
    ]);
    expect(result.finishReason.unified).toBe("stop");
  });

  it("AZURECHAT_E2E_SCRIPT text kind overrides the emitted text", async () => {
    process.env.AZURECHAT_E2E_SCRIPT = JSON.stringify({
      kind: "text",
      text: "hello",
    });

    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    const { stream } = await (model as any).doStream({});
    const chunks = await drainStream<{ type: string; delta?: string }>(stream);

    const fullText = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta ?? "")
      .join("");

    expect(fullText).toBe("hello");
  });

  it("AZURECHAT_E2E_SCRIPT reasoning kind emits reasoning then text", async () => {
    process.env.AZURECHAT_E2E_SCRIPT = JSON.stringify({
      kind: "reasoning",
      reasoning: "think",
      text: "answer",
    });

    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    const { stream } = await (model as any).doStream({});
    const chunks = await drainStream<{ type: string; delta?: string }>(stream);

    const types = chunks.map((c) => c.type);
    expect(types).toContain("reasoning-start");
    expect(types).toContain("reasoning-delta");
    expect(types).toContain("reasoning-end");
    expect(types).toContain("text-delta");
  });

  it("AZURECHAT_E2E_SCRIPT toolCall kind emits tool-input parts then text", async () => {
    process.env.AZURECHAT_E2E_SCRIPT = JSON.stringify({
      kind: "toolCall",
      toolName: "myTool",
      args: { q: "test" },
      result: { answer: 42 },
      finalText: "done",
    });

    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    const { stream } = await (model as any).doStream({});
    const chunks = await drainStream<{ type: string; toolName?: string }>(
      stream,
    );

    const types = chunks.map((c) => c.type);
    expect(types).toContain("tool-input-start");
    expect(types).toContain("tool-input-delta");
    expect(types).toContain("tool-input-end");
    expect(types).toContain("tool-call");
    expect(types).toContain("text-delta");

    const toolCallPart = chunks.find((c) => c.type === "tool-call") as any;
    expect(toolCallPart?.toolName).toBe("myTool");
  });

  it("AZURECHAT_E2E_SCRIPT complex kind returns generated reasoning, tools, and text", async () => {
    process.env.AZURECHAT_E2E_SCRIPT = JSON.stringify({
      kind: "complex",
      reasoning: "think",
      toolCalls: [{ toolName: "myTool", args: { q: "test" }, result: { answer: 42 } }],
      finalText: "done",
    });

    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    const result = await (model as any).doGenerate({});

    expect(result.content).toEqual([
      { type: "reasoning", text: "think" },
      {
        type: "tool-call",
        toolCallId: "tc-0",
        toolName: "myTool",
        input: JSON.stringify({ q: "test" }),
      },
      { type: "text", text: "done" },
    ]);
    expect(result.finishReason.unified).toBe("tool-calls");
  });

  it("AZURECHAT_E2E_SCRIPT error kind emits an error part in the stream", async () => {
    process.env.AZURECHAT_E2E_SCRIPT = JSON.stringify({
      kind: "error",
      errorMessage: "deliberate test error",
    });

    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    const { stream } = await (model as any).doStream({});
    const chunks = await drainStream<{
      type: string;
      error?: Error;
    }>(stream);

    const errorPart = chunks.find((c) => c.type === "error") as any;
    expect(errorPart).toBeDefined();
    expect(errorPart?.error?.message).toBe("deliberate test error");
  });

  it("AZURECHAT_E2E_SCRIPT error kind makes doGenerate throw", async () => {
    process.env.AZURECHAT_E2E_SCRIPT = JSON.stringify({
      kind: "error",
      errorMessage: "generate error",
    });

    const provider = createFakeAzureProvider();
    const model = provider("gpt-4o");
    await expect((model as any).doGenerate({})).rejects.toThrow(
      "generate error",
    );
  });
});
