import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist search client mocks
const { MockSearchClient, MockSearchIndexClient, MockSearchIndexerClient } = vi.hoisted(() => {
  const MockSearchClient = vi.fn().mockImplementation(function () {
    return { _type: "SearchClient" };
  });
  const MockSearchIndexClient = vi.fn().mockImplementation(function () {
    return { _type: "SearchIndexClient" };
  });
  const MockSearchIndexerClient = vi.fn().mockImplementation(function () {
    return { _type: "SearchIndexerClient" };
  });
  return { MockSearchClient, MockSearchIndexClient, MockSearchIndexerClient };
});

vi.mock("@azure/search-documents", () => ({
  SearchClient: MockSearchClient,
  SearchIndexClient: MockSearchIndexClient,
  SearchIndexerClient: MockSearchIndexerClient,
}));

vi.mock("@/features/common/services/azure-default-credential", () => ({
  getAzureDefaultCredential: vi.fn(() => ({ _type: "credential" })),
}));

describe("common.unit.ai-search — AzureAISearchCredentials", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("common.unit.ai-search.001: returns endpoint and indexName from env vars", async () => {
    vi.stubEnv("AZURE_SEARCH_NAME", "my-search");
    vi.stubEnv("AZURE_SEARCH_INDEX_NAME", "my-index");
    const { AzureAISearchCredentials } = await import("./ai-search");
    const { endpoint, indexName } = AzureAISearchCredentials();
    expect(endpoint).toBe("https://my-search.search.windows.net");
    expect(indexName).toBe("my-index");
  });

  it("common.unit.ai-search.002: throws when AZURE_SEARCH_NAME is missing", async () => {
    vi.stubEnv("AZURE_SEARCH_NAME", "");
    vi.stubEnv("AZURE_SEARCH_INDEX_NAME", "my-index");
    const { AzureAISearchCredentials } = await import("./ai-search");
    expect(() => AzureAISearchCredentials()).toThrow(
      "One or more Azure AI Search environment variables are not set"
    );
  });

  it("common.unit.ai-search.003: throws when AZURE_SEARCH_INDEX_NAME is missing", async () => {
    vi.stubEnv("AZURE_SEARCH_NAME", "my-search");
    vi.stubEnv("AZURE_SEARCH_INDEX_NAME", "");
    const { AzureAISearchCredentials } = await import("./ai-search");
    expect(() => AzureAISearchCredentials()).toThrow(
      "One or more Azure AI Search environment variables are not set"
    );
  });
});

describe("common.unit.ai-search — AzureAISearchInstance", () => {
  beforeEach(() => {
    vi.resetModules();
    MockSearchClient.mockClear();
    vi.stubEnv("AZURE_SEARCH_NAME", "my-search");
    vi.stubEnv("AZURE_SEARCH_INDEX_NAME", "my-index");
  });

  it("common.unit.ai-search.004: creates SearchClient with correct endpoint and index name", async () => {
    const { AzureAISearchInstance } = await import("./ai-search");
    AzureAISearchInstance();
    expect(MockSearchClient).toHaveBeenCalledWith(
      "https://my-search.search.windows.net",
      "my-index",
      expect.anything()
    );
  });
});

describe("common.unit.ai-search — AzureAISearchIndexClientInstance", () => {
  beforeEach(() => {
    vi.resetModules();
    MockSearchIndexClient.mockClear();
    vi.stubEnv("AZURE_SEARCH_NAME", "my-search");
    vi.stubEnv("AZURE_SEARCH_INDEX_NAME", "my-index");
  });

  it("common.unit.ai-search.005: creates SearchIndexClient with correct endpoint", async () => {
    const { AzureAISearchIndexClientInstance } = await import("./ai-search");
    AzureAISearchIndexClientInstance();
    expect(MockSearchIndexClient).toHaveBeenCalledWith(
      "https://my-search.search.windows.net",
      expect.anything()
    );
  });
});

describe("common.unit.ai-search — AzureAISearchIndexerClientInstance", () => {
  beforeEach(() => {
    vi.resetModules();
    MockSearchIndexerClient.mockClear();
    vi.stubEnv("AZURE_SEARCH_NAME", "my-search");
    vi.stubEnv("AZURE_SEARCH_INDEX_NAME", "my-index");
  });

  it("common.unit.ai-search.006: creates SearchIndexerClient with correct endpoint", async () => {
    const { AzureAISearchIndexerClientInstance } = await import("./ai-search");
    AzureAISearchIndexerClientInstance();
    expect(MockSearchIndexerClient).toHaveBeenCalledWith(
      "https://my-search.search.windows.net",
      expect.anything()
    );
  });
});
