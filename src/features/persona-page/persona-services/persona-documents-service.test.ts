import { describe, it, expect, vi, beforeEach } from "vitest";
import { setSession, defaultSession } from "@/__tests__/helpers/session-mock";

// ── Microsoft Graph batch mock ────────────────────────────────────────────────
type BatchItem = { id: string; status: number; body?: any };
let nextBatchResponses: BatchItem[] = [];
const postSpy = vi.fn(async () => ({ responses: nextBatchResponses }));

vi.mock("@/features/common/services/microsoft-graph-client", () => ({
  getGraphClient: vi.fn(() => ({
    api: vi.fn(() => ({
      post: postSpy,
      select: vi.fn().mockReturnThis(),
      get: vi.fn(),
      responseType: vi.fn().mockReturnThis(),
    })),
  })),
}));

vi.mock("@/features/common/services/cosmos", () => ({
  HistoryContainer: () => ({
    items: { upsert: vi.fn(), query: vi.fn(() => ({ fetchAll: async () => ({ resources: [] }) })) },
    item: vi.fn(() => ({ read: vi.fn(), delete: vi.fn() })),
  }),
  ConfigContainer: () => ({}),
}));

vi.mock("@/features/auth-page/auth-api", () => ({ options: {}, authOptions: {} }));

vi.mock("@/features/common/services/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("@/features/chat-page/chat-services/azure-ai-search/azure-ai-search", () => ({
  DeleteSearchDocumentByPersonaDocumentId: vi.fn(),
  IndexDocuments: vi.fn(),
  PersonaDocumentExistsInIndex: vi.fn(),
}));

vi.mock("@/features/common/services/document-intelligence", () => ({
  DocumentIntelligenceInstance: vi.fn(),
}));

vi.mock("@/features/chat-page/chat-services/chat-document-service", () => ({
  ChunkDocumentWithOverlap: vi.fn(),
}));

import { DocumentDetails } from "./persona-documents-service";

const sharepointDoc = (id: string) => ({
  id,
  documentId: id,
  parentReference: { driveId: "drive-1" },
});

const okBatch = (id: string, size: number) => ({
  id,
  status: 200,
  body: {
    id,
    name: `${id}.pdf`,
    size,
    createdBy: { user: { displayName: "Test User" } },
    createdDateTime: "2024-01-01",
    parentReference: { driveId: "drive-1" },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  setSession(defaultSession);
  nextBatchResponses = [];
  process.env.MAX_PERSONA_DOCUMENT_LIMIT = "10";
  process.env.MAX_PERSONA_DOCUMENT_SIZE = "10485760"; // 10MB
});

describe("DocumentDetails — issue #113: CI size limit handling", () => {
  it("flags >10MB as sizeToBig under default (regular agent doc) limits", async () => {
    nextBatchResponses = [okBatch("big-pdf", 25 * 1024 * 1024)];

    const result = await DocumentDetails([sharepointDoc("big-pdf")]);

    expect(result.status).toBe("OK");
    if (result.status === "OK") {
      expect(result.response.successful).toHaveLength(0);
      expect(result.response.sizeToBig).toHaveLength(1);
      expect(result.response.sizeToBig[0].name).toBe("big-pdf.pdf");
    }
  });

  it("accepts a 25MB file when caller raises maxSize (Code Interpreter path)", async () => {
    nextBatchResponses = [okBatch("ci-pdf", 25 * 1024 * 1024)];

    const result = await DocumentDetails([sharepointDoc("ci-pdf")], {
      maxSize: 512 * 1024 * 1024,
      maxCount: 20,
    });

    expect(result.status).toBe("OK");
    if (result.status === "OK") {
      expect(result.response.successful).toHaveLength(1);
      expect(result.response.sizeToBig).toHaveLength(0);
    }
  });

  it("still flags files above the CI maxSize (e.g. 600MB > 512MB)", async () => {
    nextBatchResponses = [okBatch("huge", 600 * 1024 * 1024)];

    const result = await DocumentDetails([sharepointDoc("huge")], {
      maxSize: 512 * 1024 * 1024,
      maxCount: 20,
    });

    expect(result.status).toBe("OK");
    if (result.status === "OK") {
      expect(result.response.sizeToBig).toHaveLength(1);
    }
  });

  it("enforces caller-supplied maxCount", async () => {
    const docs = Array.from({ length: 21 }, (_, i) => sharepointDoc(`d${i}`));

    const result = await DocumentDetails(docs, {
      maxSize: 512 * 1024 * 1024,
      maxCount: 20,
    });

    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") {
      expect(result.errors[0].message).toContain("Maximum is 20");
    }
  });
});
