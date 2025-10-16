import { DocumentAnalysisClient } from "@azure/ai-form-recognizer";
import { getAzureDefaultCredential } from "./azure-default-credential";

export const DocumentIntelligenceInstance = () => {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;

  if (!endpoint) {
    throw new Error(
      "Document Intelligence endpoint environment variable is not set"
    );
  }

  const client = new DocumentAnalysisClient(
    endpoint,
    getAzureDefaultCredential()
  );

  return client;
};
