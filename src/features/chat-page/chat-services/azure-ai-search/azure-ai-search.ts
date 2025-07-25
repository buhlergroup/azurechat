"use server";
import "server-only";

import { userHashedId } from "@/features/auth-page/helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import {
  AzureAISearchIndexClientInstance,
  AzureAISearchInstance,
} from "@/features/common/services/ai-search";
import { OpenAIEmbeddingInstance } from "@/features/common/services/openai";
import { uniqueId } from "@/features/common/util";
import {
  AzureKeyCredential,
  SearchClient,
  SearchIndex,
} from "@azure/search-documents";

export interface AzureSearchDocumentIndex {
  id: string;
  pageContent: string;
  embedding?: number[];
  user: string;
  chatThreadId: string | null;
  metadata: string | null;
  personaDocumentId: string | null;
}

export type DocumentSearchResponse = {
  score: number;
  document: AzureSearchDocumentIndex;
};

export const SimpleSearch = async (
  searchText?: string,
  filter?: string
): Promise<ServerActionResponse<Array<DocumentSearchResponse>>> => {
  try {
    const instance = AzureAISearchInstance<AzureSearchDocumentIndex>();
    const searchResults = await instance.search(searchText, { filter: filter });

    const results: Array<DocumentSearchResponse> = [];
    for await (const result of searchResults.results) {
      results.push({
        score: result.score,
        document: result.document,
      });
    }

    return {
      status: "OK",
      response: results,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const SimilaritySearch = async (
  searchText: string,
  k: number,
  filter?: string,
  skip: number = 0,
  shouldCreateEmbedding: boolean = true
): Promise<ServerActionResponse<Array<DocumentSearchResponse>>> => {
  try {
    let embeddings;
    
    if (shouldCreateEmbedding) {
      const openai = OpenAIEmbeddingInstance();
      embeddings = await openai.embeddings.create({
        input: searchText,
        model: "",
      });
    }

    const searchClient = AzureAISearchInstance<AzureSearchDocumentIndex>();

    const searchOptions: any = {
      top: k,
      filter: filter,
      skip: skip,
    };

    // Only add vector search if embeddings were created
    if (shouldCreateEmbedding && embeddings) {
      searchOptions.vectorSearchOptions = {
        queries: [
          {
            vector: embeddings.data[0].embedding,
            fields: ["embedding"],
            kind: "vector",
            kNearestNeighborsCount: k
          },
        ],
      };
    }

    const searchResults = await searchClient.search(searchText, searchOptions);

    const results: Array<DocumentSearchResponse> = [];
    for await (const result of searchResults.results) {
      results.push({
        score: result.score,
        document: result.document,
      });
    }

    return {
      status: "OK",
      response: results,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const PersonaDocumentExistsInIndex = async (
  personaDocumentId: string
): Promise<ServerActionResponse<AzureSearchDocumentIndex>> => {
  const result = await SimpleSearch(
    personaDocumentId,
    `personaDocumentId eq '${personaDocumentId}'`
  );

  if (result.status === "OK") {
    const documents = result.response;
    if (documents.length > 0) {
      return {
        status: "OK",
        response: documents[0].document,
      };
    } else {
      return {
        status: "NOT_FOUND",
        errors: [
          {
            message: `No document found with id ${personaDocumentId}`,
          },
        ],
      };
    }
  }

  return {
    status: "ERROR",
    errors: [
      {
        message: `Unexpected error occurred while checking persona document index.`,
      },
    ],
  };
};

export const ExtensionSimilaritySearch = async (props: {
  searchText: string;
  vectors: string[];
  apiKey: string;
  searchName: string;
  indexName: string;
  shouldCreateEmbedding?: boolean;
}): Promise<ServerActionResponse<Array<DocumentSearchResponse>>> => {
  try {
    const { searchText, vectors, apiKey, searchName, indexName, shouldCreateEmbedding = true } = props;

    let embeddings;
    if (shouldCreateEmbedding) {
      const openai = OpenAIEmbeddingInstance();
      embeddings = await openai.embeddings.create({
        input: searchText,
        model: "",
      });
    }

    const endpoint = `https://${searchName}.search.windows.net`;

    const searchClient = new SearchClient(
      endpoint,
      indexName,
      new AzureKeyCredential(apiKey)
    );

    const searchOptions: any = {
      top: 3,
    };

    // Only add vector search if embeddings were created
    if (shouldCreateEmbedding && embeddings) {
      searchOptions.vectorSearchOptions = {
        queries: [
          {
            vector: embeddings.data[0].embedding,
            fields: vectors,
            kind: "vector",
            kNearestNeighborsCount: 10,
          },
        ],
      };
    }

    const searchResults = await searchClient.search(searchText, searchOptions);

    const results: Array<any> = [];
    for await (const result of searchResults.results) {
      const item = {
        score: result.score,
        document: result.document,
      };

      // exclude the all the fields that are not in the fields array
      const document = item.document as any;
      const newDocument: any = {};

      // iterate over the object entries in document
      // and only include the fields that are in the fields array

      for (const key in document) {
        const hasKey = vectors.includes(key);
        if (!hasKey) {
          newDocument[key] = document[key];
        }
      }

      results.push({
        score: result.score,
        document: newDocument, // Use the newDocument object instead of the original document
      });
    }

    return {
      status: "OK",
      response: results,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const IndexDocuments = async (
  docs: string[],
  fileName?: string,
  chatThreadId?: string,
  personaDocumentId?: string
): Promise<Array<ServerActionResponse<boolean>>> => {
  try {
    const documentsToIndex: AzureSearchDocumentIndex[] = [];

    for (const doc of docs) {
      const docToAdd: AzureSearchDocumentIndex = {
        id: uniqueId(),
        chatThreadId: chatThreadId || null,
        user: await userHashedId(),
        pageContent: doc,
        metadata: fileName || null,
        embedding: [],
        personaDocumentId: personaDocumentId || null,
      };

      documentsToIndex.push(docToAdd);
    }

    const instance = AzureAISearchInstance();
    const embeddingsResponse = await EmbedDocuments(documentsToIndex);

    if (embeddingsResponse.status === "OK") {
      const uploadResponse = await instance.uploadDocuments(
        embeddingsResponse.response
      );

      const response: ServerActionResponse<boolean>[] = [];
      uploadResponse.results.forEach((r) => {
        if (r.succeeded) {
          response.push({
            status: "OK",
            response: r.succeeded,
          });
        } else {
          response.push({
            status: "ERROR",
            errors: [
              {
                message: `${r.errorMessage}`,
              },
            ],
          });
        }
      });

      return response;
    }

    return [embeddingsResponse];
  } catch (e) {
    return [
      {
        status: "ERROR",
        errors: [
          {
            message: `${e}`,
          },
        ],
      },
    ];
  }
};

export const DeleteDocumentsOfChatThread = async (
  chatThreadId: string
): Promise<Array<ServerActionResponse<boolean>>> => {
  try {
    // find all documents for chat thread
    const documentsInChatResponse = await SimpleSearch(
      undefined,
      `chatThreadId eq '${chatThreadId} and userid eq '${await userHashedId()}'`
    );

    if (documentsInChatResponse.status === "OK") {
      const instance = AzureAISearchInstance();
      const deletedResponse = await instance.deleteDocuments(
        documentsInChatResponse.response.map((r) => r.document)
      );
      const response: Array<ServerActionResponse<boolean>> = [];
      deletedResponse.results.forEach((r) => {
        if (r.succeeded) {
          response.push({
            status: "OK",
            response: r.succeeded,
          });
        } else {
          response.push({
            status: "ERROR",
            errors: [
              {
                message: `${r.errorMessage}`,
              },
            ],
          });
        }
      });

      return response;
    }

    return [documentsInChatResponse];
  } catch (e) {
    return [
      {
        status: "ERROR",
        errors: [
          {
            message: `${e}`,
          },
        ],
      },
    ];
  }
};

export const DeleteSearchDocumentByPersonaDocumentId = async (
  personaDocumentId: string
): Promise<ServerActionResponse<boolean>> => {
  try {
    // Find the document using personaDocumentId
    const documentResponse = await SimpleSearch(
      undefined,
      `personaDocumentId eq '${personaDocumentId}' and user eq '${await userHashedId()}'`
    );

    if (
      documentResponse.status === "OK" &&
      documentResponse.response.length > 0
    ) {
      const documents = documentResponse.response.map((r) => r.document);
      const instance = AzureAISearchInstance();

      const deletedResponse = await instance.deleteDocuments(documents);

      if (deletedResponse.results.every((r) => r.succeeded)) {
        return {
          status: "OK",
          response: true,
        };
      } else {
        return {
          status: "ERROR",
          errors: deletedResponse.results
            .filter((r) => !r.succeeded)
            .map((r) => ({
              message: r.errorMessage || "Unknown error",
            })),
        };
      }
    } else {
      return {
        status: "ERROR",
        errors: [
          {
            message: `No document found with personaDocumentId: ${personaDocumentId}`,
          },
        ],
      };
    }
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const EmbedDocuments = async (
  documents: Array<AzureSearchDocumentIndex>
): Promise<ServerActionResponse<Array<AzureSearchDocumentIndex>>> => {
  try {
    const openai = OpenAIEmbeddingInstance();

    const contentsToEmbed = documents.map((d) => d.pageContent);

    const embeddings = await openai.embeddings.create({
      input: contentsToEmbed,
      model: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME,
    });

    embeddings.data.forEach((embedding, index) => {
      documents[index].embedding = embedding.embedding;
    });

    return {
      status: "OK",
      response: documents,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const EnsureIndexIsCreated = async (): Promise<
  ServerActionResponse<SearchIndex>
> => {
  try {
    const client = AzureAISearchIndexClientInstance();
    const result = await client.getIndex(process.env.AZURE_SEARCH_INDEX_NAME);
    return {
      status: "OK",
      response: result,
    };
  } catch (e) {
    return await CreateSearchIndex();
  }
};

const CreateSearchIndex = async (): Promise<
  ServerActionResponse<SearchIndex>
> => {
  try {
    const client = AzureAISearchIndexClientInstance();
    const result = await client.createIndex({
      name: process.env.AZURE_SEARCH_INDEX_NAME,
      vectorSearch: {
        algorithms: [
          {
            name: "hnsw-vector",
            kind: "hnsw",
            parameters: {
              m: 4,
              efConstruction: 200,
              efSearch: 200,
              metric: "cosine",
            },
          },
        ],
        profiles: [
          {
            name: "hnsw-vector",
            algorithmConfigurationName: "hnsw-vector",
          },
        ],
      },

      fields: [
        {
          name: "id",
          type: "Edm.String",
          key: true,
          filterable: true,
        },
        {
          name: "user",
          type: "Edm.String",
          searchable: true,
          filterable: true,
        },
        {
          name: "chatThreadId",
          type: "Edm.String",
          searchable: true,
          filterable: true,
        },
        {
          name: "personaDocumentId",
          type: "Edm.String",
          searchable: true,
          filterable: true,
        },
        {
          name: "pageContent",
          searchable: true,
          type: "Edm.String",
        },
        {
          name: "metadata",
          type: "Edm.String",
        },
        {
          name: "embedding",
          type: "Collection(Edm.Single)",
          searchable: true,
          filterable: false,
          sortable: false,
          facetable: false,
          vectorSearchDimensions: 1536,
          vectorSearchProfileName: "hnsw-vector",
        },
      ],
    });

    return {
      status: "OK",
      response: result,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};
