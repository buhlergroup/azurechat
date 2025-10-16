import { SearchClient, SearchIndexClient, SearchIndexerClient } from "@azure/search-documents";
import { getAzureDefaultCredential } from "./azure-default-credential";

export const AzureAISearchCredentials = () => {
  const searchName = process.env.AZURE_SEARCH_NAME;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

  if (!searchName || !indexName) {
    throw new Error(
      "One or more Azure AI Search environment variables are not set"
    );
  }

  const endpoint = `https://${searchName}.search.windows.net`;
  return {
    endpoint,
    indexName,
  };
};

export const AzureAISearchInstance = <T extends object>() => {
  const { endpoint, indexName } = AzureAISearchCredentials();
  const credential = getAzureDefaultCredential();

  const searchClient = new SearchClient<T>(
    endpoint,
    indexName,
    credential
  );

  return searchClient;
};

export const AzureAISearchIndexClientInstance = () => {
  const { endpoint } = AzureAISearchCredentials();
  const credential = getAzureDefaultCredential();

  const searchClient = new SearchIndexClient(endpoint, credential);

  return searchClient;
};

export const AzureAISearchIndexerClientInstance = () => {
  const { endpoint } = AzureAISearchCredentials();
  const credential = getAzureDefaultCredential();

  const client = new SearchIndexerClient(endpoint, credential);

  return client;
};
