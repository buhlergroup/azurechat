import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── module mocks ────────────────────────────────────────────────────────────
vi.mock("@/features/common/services/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/features/auth-page/helpers", () => ({
  userHashedId: vi.fn(async () => "hashed-user"),
  getCurrentUser: vi.fn(async () => ({
    name: "Test",
    email: "test@example.com",
    isAdmin: false,
    token: "tok",
  })),
}));

vi.mock("@/features/persona-page/persona-services/persona-documents-service", () => ({
  AllowedPersonaDocumentIds: vi.fn(async () => []),
}));

vi.mock("@/features/persona-page/persona-services/persona-service", () => ({
  FindPersonaByID: vi.fn(async () => ({
    status: "NOT_FOUND",
    errors: [{ message: "not found" }],
  })),
  FindAllPersonaForCurrentUser: vi.fn(async () => ({ status: "OK", response: [] })),
}));

vi.mock("../azure-ai-search/azure-ai-search", () => ({
  SimilaritySearch: vi.fn(async () => ({ status: "OK", response: [] })),
}));

vi.mock("../citation-service", () => ({
  CreateCitations: vi.fn(async () => []),
  FormatCitations: vi.fn((docs: any[]) => docs),
}));

vi.mock("../models/provider", () => ({
  resolveAzureModel: vi.fn(() => ({ modelId: "gpt-5.4-mini" })),
}));

// Bypass the SSRF guard for unit tests that call an extension tool's
// execute() — the guard's own behavior is covered by extension-url-guard.test.ts.
vi.mock("../extension-url-guard", () => ({
  assertExtensionUrlAllowed: vi.fn(async (u: string) => u),
}));

// ─── subject under test ───────────────────────────────────────────────────────
import { buildToolset, buildExtensionToolKey } from "../registry";
import type { ToolContext } from "../tool-context";
import type { ExtensionModel } from "@/features/extensions-page/extension-services/models";
import type { Tool } from "@ai-sdk/provider-utils";

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    user: "user-hash",
    threadId: "thread-1",
    threadDocumentIds: [],
    personaDocumentIds: [],
    defaultTools: {},
    extensions: [],
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────
describe("buildToolset – key ordering invariant", () => {
  it("returns keys in localeCompare ascending order (empty context)", async () => {
    const toolset = await buildToolset(makeCtx());
    const keys = Object.keys(toolset);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });

  it("returns keys in localeCompare ascending order (all features enabled)", async () => {
    const ctx = makeCtx({
      threadDocumentIds: ["doc-1"],
      defaultTools: { companyContent: true },
    });
    const toolset = await buildToolset(ctx);
    const keys = Object.keys(toolset);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });

  it("keys remain sorted even when extension tools have names that collide alphabetically", async () => {
    const fakeExtension: ExtensionModel = {
      id: "ext-1",
      name: "My Extension",
      description: "test",
      executionSteps: "steps",
      headers: [],
      userId: "user-1",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: "fn-a",
          functionName: "zz_last",
          code: JSON.stringify({
            name: "zz_last",
            description: "z tool",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://example.com/zz",
          endpointType: "POST",
          isOpen: false,
        },
        {
          id: "fn-b",
          functionName: "aa_first",
          code: JSON.stringify({
            name: "aa_first",
            description: "a tool",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://example.com/aa",
          endpointType: "POST",
          isOpen: false,
        },
      ],
    };

    const ctx = makeCtx({
      extensions: [{ extension: fakeExtension, headerSecrets: {} }],
    });
    const toolset = await buildToolset(ctx);
    const keys = Object.keys(toolset);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
    // Verify both tools present, namespaced with the (8-char, here shorter)
    // extension id prefix — see buildExtensionToolKey in ../registry.
    expect(keys).toContain("ext-1_aa_first");
    expect(keys).toContain("ext-1_zz_last");
  });
});

describe("buildToolset – conditional tool inclusion", () => {
  it("omits search_documents when no documents in context", async () => {
    const ctx = makeCtx({ threadDocumentIds: [], personaDocumentIds: [] });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("search_documents");
  });

  it("includes search_documents when thread has documents", async () => {
    const ctx = makeCtx({ threadDocumentIds: ["doc-1"] });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("search_documents");
  });

  it("includes search_documents when persona has documents", async () => {
    const ctx = makeCtx({ personaDocumentIds: ["pdoc-1"] });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("search_documents");
  });

  it("omits search_company_content when toggle is off", async () => {
    const ctx = makeCtx({ defaultTools: { companyContent: false } });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("search_company_content");
  });

  it("includes search_company_content when toggle is on", async () => {
    const ctx = makeCtx({ defaultTools: { companyContent: true } });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("search_company_content");
  });

  it("includes call_sub_agent and search_sub_agent when the thread declares subAgentIds", async () => {
    const ctx = makeCtx({ defaultTools: {}, subAgentIds: ["a1"], depth: 0 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("call_sub_agent");
    expect(Object.keys(toolset)).toContain("search_sub_agent");
  });

  it("ALSO includes sub-agent tools when subAgentIds is empty — any persona can be called", async () => {
    const ctx = makeCtx({ defaultTools: {}, subAgentIds: [], depth: 0 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("call_sub_agent");
    expect(Object.keys(toolset)).toContain("search_sub_agent");
  });

  it("ALSO includes sub-agent tools when subAgentIds is undefined — discovery via search_sub_agent", async () => {
    const ctx = makeCtx({ defaultTools: {}, depth: 0 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).toContain("call_sub_agent");
    expect(Object.keys(toolset)).toContain("search_sub_agent");
  });

  it("excludes sub-agent tools at depth >= 2 (recursion guard)", async () => {
    const ctx = makeCtx({ defaultTools: {}, subAgentIds: ["a1"], depth: 2 });
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("call_sub_agent");
    expect(Object.keys(toolset)).not.toContain("search_sub_agent");
  });
});

describe("buildToolset – extension tools", () => {
  it("registers extension tools by parsed function name", async () => {
    const fakeExtension: ExtensionModel = {
      id: "ext-2",
      name: "Ext2",
      description: "d",
      executionSteps: "s",
      headers: [],
      userId: "u",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: "fn-1",
          functionName: "my_api_call",
          code: JSON.stringify({
            name: "my_api_call",
            description: "desc",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://api.example.com/call",
          endpointType: "POST",
          isOpen: false,
        },
      ],
    };

    const ctx = makeCtx({
      extensions: [{ extension: fakeExtension, headerSecrets: { "x-api-key": "secret" } }],
    });
    const toolset = await buildToolset(ctx);
    // Namespaced with the extension id prefix — see buildExtensionToolKey.
    expect(Object.keys(toolset)).toContain("ext-2_my_api_call");
  });

  it("skips extension functions with unparseable code without throwing", async () => {
    const fakeExtension: ExtensionModel = {
      id: "ext-3",
      name: "Ext3",
      description: "d",
      executionSteps: "s",
      headers: [],
      userId: "u",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: "fn-bad",
          functionName: "bad_fn",
          code: "NOT VALID JSON {{{",
          endpoint: "https://api.example.com",
          endpointType: "GET",
          isOpen: false,
        },
      ],
    };

    const ctx = makeCtx({
      extensions: [{ extension: fakeExtension, headerSecrets: {} }],
    });
    // Should not throw
    const toolset = await buildToolset(ctx);
    expect(Object.keys(toolset)).not.toContain("bad_fn");
  });
});

// ─── buildExtensionToolKey — pure keying function ─────────────────────────────
describe("buildExtensionToolKey", () => {
  it("namespaces with the first 8 chars of the extension id", () => {
    expect(buildExtensionToolKey("abcdefgh12345678", "aisearch")).toBe(
      "abcdefgh_aisearch"
    );
  });

  it("uses the whole id as the prefix when shorter than 8 chars", () => {
    expect(buildExtensionToolKey("ext-1", "aisearch")).toBe("ext-1_aisearch");
  });

  it("sanitizes characters outside [A-Za-z0-9_-] in the function name", () => {
    expect(buildExtensionToolKey("abcdefgh", "my api.call!")).toBe(
      "abcdefgh_my_api_call_"
    );
  });

  it("truncates the combined key to 64 characters", () => {
    const longName = "a".repeat(100);
    const key = buildExtensionToolKey("abcdefgh", longName);
    expect(key.length).toBe(64);
    expect(key.startsWith("abcdefgh_")).toBe(true);
  });

  it("produces distinct keys for two extensions sharing the same functionName", () => {
    const keyA = buildExtensionToolKey("ext1id.aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "aisearch");
    const keyB = buildExtensionToolKey("ext2id.bbbbbbbbbbbbbbbbbbbbbbbbbbbb", "aisearch");
    expect(keyA).not.toBe(keyB);
  });
});

// ─── Regression: 43-of-82 prod extensions share functionName "aisearch" ──────
describe("buildToolset – extension tool key collisions (regression)", () => {
  function makeAisearchExtension(
    id: string,
    endpoint: string,
    apiKey: string
  ): { extension: ExtensionModel; headerSecrets: Record<string, string> } {
    const extension: ExtensionModel = {
      id,
      name: `Extension ${id}`,
      description: "d",
      executionSteps: "s",
      headers: [],
      userId: "u",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: `${id}-fn`,
          functionName: "aisearch",
          code: JSON.stringify({
            name: "aisearch",
            description: "Search extension-specific content",
            parameters: {
              type: "object",
              properties: { q: { type: "string" } },
              required: ["q"],
            },
          }),
          endpoint,
          endpointType: "POST",
          isOpen: false,
        },
      ],
    };
    return { extension, headerSecrets: { "x-api-key": apiKey } };
  }

  it("registers BOTH tools under distinct namespaced keys instead of the second overwriting the first", async () => {
    // Two different extensions in prod, both authored with functionName
    // "aisearch" — exactly the 43-of-82 collision pattern this fix targets.
    const extA = makeAisearchExtension(
      "aaaaaaaa1111111111111111111111111111",
      "https://extension-a.example.com/search",
      "key-a"
    );
    const extB = makeAisearchExtension(
      "bbbbbbbb2222222222222222222222222222",
      "https://extension-b.example.com/search",
      "key-b"
    );

    const ctx = makeCtx({ extensions: [extA, extB] });
    const toolset = await buildToolset(ctx);
    const keys = Object.keys(toolset);

    const keyA = buildExtensionToolKey(extA.extension.id, "aisearch");
    const keyB = buildExtensionToolKey(extB.extension.id, "aisearch");

    expect(keyA).not.toBe(keyB);
    expect(keys).toContain(keyA);
    expect(keys).toContain(keyB);
    // Pre-fix behavior: only ONE "aisearch" entry would exist, whichever
    // extension was inserted last. Guard against regressing back to that.
    expect(keys.filter((k) => k.endsWith("_aisearch")).length).toBe(2);
  });

  it("each namespaced tool dispatches to its OWN extension's endpoint and headers, not the other's", async () => {
    const extA = makeAisearchExtension(
      "aaaaaaaa1111111111111111111111111111",
      "https://extension-a.example.com/search",
      "key-a"
    );
    const extB = makeAisearchExtension(
      "bbbbbbbb2222222222222222222222222222",
      "https://extension-b.example.com/search",
      "key-b"
    );

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const ctx = makeCtx({ extensions: [extA, extB] });
    const toolset = await buildToolset(ctx);

    const keyA = buildExtensionToolKey(extA.extension.id, "aisearch");
    const keyB = buildExtensionToolKey(extB.extension.id, "aisearch");
    const toolA = toolset[keyA] as Tool & {
      execute: (input: unknown, opts: { abortSignal?: AbortSignal }) => Promise<unknown>;
    };
    const toolB = toolset[keyB] as Tool & {
      execute: (input: unknown, opts: { abortSignal?: AbortSignal }) => Promise<unknown>;
    };

    await toolA.execute({ q: "from-a" }, { abortSignal: undefined });
    await toolB.execute({ q: "from-b" }, { abortSignal: undefined });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [urlA, initA] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    const [urlB, initB] = mockFetch.mock.calls[1] as unknown as [string, RequestInit];

    expect(urlA).toBe("https://extension-a.example.com/search");
    expect((initA.headers as Record<string, string>)["x-api-key"]).toBe("key-a");

    expect(urlB).toBe("https://extension-b.example.com/search");
    expect((initB.headers as Record<string, string>)["x-api-key"]).toBe("key-b");

    vi.unstubAllGlobals();
  });

  it("deduplicates deterministically (keeps first registration) when the same functionName repeats within one extension", async () => {
    const dupeExtension: ExtensionModel = {
      id: "dupe-ext",
      name: "Dupe",
      description: "d",
      executionSteps: "s",
      headers: [],
      userId: "u",
      isPublished: true,
      createdAt: new Date(),
      type: "EXTENSION",
      functions: [
        {
          id: "fn-first",
          functionName: "aisearch",
          code: JSON.stringify({
            name: "aisearch",
            description: "first",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://first.example.com",
          endpointType: "POST",
          isOpen: false,
        },
        {
          id: "fn-second",
          functionName: "aisearch",
          code: JSON.stringify({
            name: "aisearch",
            description: "second",
            parameters: { type: "object", properties: {}, required: [] },
          }),
          endpoint: "https://second.example.com",
          endpointType: "POST",
          isOpen: false,
        },
      ],
    };

    const ctx = makeCtx({
      extensions: [{ extension: dupeExtension, headerSecrets: {} }],
    });
    // Should not throw despite the intra-extension key collision.
    const toolset = await buildToolset(ctx);
    const key = buildExtensionToolKey("dupe-ext", "aisearch");
    const keys = Object.keys(toolset).filter((k) => k === key);
    expect(keys.length).toBe(1);
    expect((toolset[key] as Tool & { description?: string }).description).toBe(
      "first"
    );
  });
});

describe("buildToolset – sample sorted output", () => {
  it("emits expected key order for a realistic context", async () => {
    const ctx = makeCtx({
      threadDocumentIds: ["d1"],
      defaultTools: { companyContent: true },
      subAgentIds: ["a1"],
      depth: 0,
    });
    const toolset = await buildToolset(ctx);
    const keys = Object.keys(toolset);
    // Spot-check: call_sub_agent < search_company_content < search_documents < search_sub_agent
    expect(keys.indexOf("call_sub_agent")).toBeLessThan(
      keys.indexOf("search_company_content")
    );
    expect(keys.indexOf("search_company_content")).toBeLessThan(
      keys.indexOf("search_documents")
    );
    expect(keys.indexOf("search_documents")).toBeLessThan(
      keys.indexOf("search_sub_agent")
    );
  });
});
