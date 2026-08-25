import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock @azure/cosmos and the default credential before importing cosmos.ts
// Use vi.hoisted so the mock factory runs before module initialization

const { mockCosmosClientConstructor, mockContainerFn, mockDatabaseFn } = vi.hoisted(() => {
  const mockContainerFn = vi.fn((name: string) => ({ _name: name }));
  const mockDatabaseFn = vi.fn(() => ({ container: mockContainerFn }));
  const mockCosmosClientConstructor = vi.fn().mockImplementation(function () {
    return { database: mockDatabaseFn };
  });
  return { mockCosmosClientConstructor, mockContainerFn, mockDatabaseFn };
});

vi.mock("@azure/cosmos", () => ({
  CosmosClient: mockCosmosClientConstructor,
}));

vi.mock("@/features/common/services/azure-default-credential", () => ({
  getAzureDefaultCredential: vi.fn(() => ({})),
}));

describe("common.unit.cosmos — container wiring", () => {
  beforeEach(async () => {
    // Reset module registry so each test gets a fresh singleton.
    vi.resetModules();
    // The service container stores registry + singletons on globalThis to
    // survive Turbopack chunk duplication; module reset alone doesn't clear
    // them. Reset explicitly so cosmos.ts re-registers its production factory
    // and the CosmosClient mock gets re-invoked.
    const { reset } = await import("./service-container");
    reset();
    mockCosmosClientConstructor.mockClear();
    mockContainerFn.mockClear();
    mockDatabaseFn.mockClear();
  });

  it("common.unit.cosmos.004: CosmosInstance throws when AZURE_COSMOSDB_URI is not set", async () => {
    vi.stubEnv("AZURE_COSMOSDB_URI", "");
    const { CosmosInstance } = await import("./cosmos");
    expect(() => CosmosInstance()).toThrow("Azure Cosmos DB endpoint is not configured");
    vi.stubEnv("AZURE_COSMOSDB_URI", "https://cosmos.test.local");
  });

  it("common.unit.cosmos.001: HistoryContainer uses AZURE_COSMOSDB_CONTAINER_NAME (history)", async () => {
    // env set by setup.ts: AZURE_COSMOSDB_CONTAINER_NAME = "history"
    const { HistoryContainer } = await import("./cosmos");
    HistoryContainer();
    expect(mockContainerFn).toHaveBeenCalledWith("history");
  });

  it("common.unit.cosmos.002: ConfigContainer uses AZURE_COSMOSDB_CONFIG_CONTAINER_NAME (config)", async () => {
    const { ConfigContainer } = await import("./cosmos");
    ConfigContainer();
    expect(mockContainerFn).toHaveBeenCalledWith("config");
  });

  it("common.unit.cosmos.003: CosmosInstance is a singleton across calls", async () => {
    const { CosmosInstance } = await import("./cosmos");
    CosmosInstance();
    CosmosInstance();
    // Constructor should have been called only once (singleton pattern)
    expect(mockCosmosClientConstructor).toHaveBeenCalledTimes(1);
  });
});
