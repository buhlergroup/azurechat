import { describe, it, expect, vi, beforeEach } from "vitest";

const { MockDocumentAnalysisClient } = vi.hoisted(() => {
  const MockDocumentAnalysisClient = vi.fn().mockImplementation(function () {
    return { _type: "DocumentAnalysisClient" };
  });
  return { MockDocumentAnalysisClient };
});

vi.mock("@azure/ai-form-recognizer", () => ({
  DocumentAnalysisClient: MockDocumentAnalysisClient,
}));

vi.mock("@/features/common/services/azure-default-credential", () => ({
  getAzureDefaultCredential: vi.fn(() => ({ _type: "credential" })),
}));

describe("common.unit.document-intelligence — DocumentIntelligenceInstance", () => {
  beforeEach(() => {
    vi.resetModules();
    MockDocumentAnalysisClient.mockClear();
  });

  it("common.unit.doc-intel.001: creates DocumentAnalysisClient with configured endpoint", async () => {
    vi.stubEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "https://my-di.cognitiveservices.azure.com");
    const { DocumentIntelligenceInstance } = await import("./document-intelligence");
    DocumentIntelligenceInstance();
    expect(MockDocumentAnalysisClient).toHaveBeenCalledWith(
      "https://my-di.cognitiveservices.azure.com",
      expect.anything()
    );
  });

  it("common.unit.doc-intel.002: throws when AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT is not set", async () => {
    vi.stubEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "");
    const { DocumentIntelligenceInstance } = await import("./document-intelligence");
    expect(() => DocumentIntelligenceInstance()).toThrow(
      "Document Intelligence endpoint environment variable is not set"
    );
  });
});
