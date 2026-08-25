import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist constructor + getBearerTokenProvider mocks
const { MockDefaultAzureCredential, mockGetBearerTokenProvider } = vi.hoisted(() => {
  const MockDefaultAzureCredential = vi.fn().mockImplementation(function () {
    return { _type: "DefaultAzureCredential" };
  });
  const mockGetBearerTokenProvider = vi.fn(() => async () => "bearer-token");
  return { MockDefaultAzureCredential, mockGetBearerTokenProvider };
});

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: MockDefaultAzureCredential,
  getBearerTokenProvider: mockGetBearerTokenProvider,
}));

describe("common.unit.azure-default-credential — getAzureDefaultCredential", () => {
  beforeEach(() => {
    vi.resetModules();
    MockDefaultAzureCredential.mockClear();
  });

  it("common.unit.azure-cred.001: creates a DefaultAzureCredential instance on first call", async () => {
    const { getAzureDefaultCredential } = await import("./azure-default-credential");
    const cred = getAzureDefaultCredential();
    expect(cred).toBeDefined();
    expect(MockDefaultAzureCredential).toHaveBeenCalledTimes(1);
  });

  it("common.unit.azure-cred.002: returns the same singleton on subsequent calls", async () => {
    const { getAzureDefaultCredential } = await import("./azure-default-credential");
    const c1 = getAzureDefaultCredential();
    const c2 = getAzureDefaultCredential();
    expect(c1).toBe(c2);
    // Constructor called once (singleton)
    expect(MockDefaultAzureCredential).toHaveBeenCalledTimes(1);
  });
});

describe("common.unit.azure-default-credential — getAzureCognitiveServicesTokenProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetBearerTokenProvider.mockClear();
  });

  it("common.unit.azure-cred.003: calls getBearerTokenProvider with the correct cognitive-services scope", async () => {
    const { getAzureCognitiveServicesTokenProvider } = await import("./azure-default-credential");
    const provider = getAzureCognitiveServicesTokenProvider();
    expect(provider).toBeDefined();
    expect(mockGetBearerTokenProvider).toHaveBeenCalledWith(
      expect.anything(),
      "https://cognitiveservices.azure.com/.default"
    );
  });

  it("common.unit.azure-cred.004: returned provider is a function (token factory)", async () => {
    const { getAzureCognitiveServicesTokenProvider } = await import("./azure-default-credential");
    const provider = getAzureCognitiveServicesTokenProvider();
    expect(typeof provider).toBe("function");
  });
});
