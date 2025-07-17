import { ExtensionSimilaritySearch } from "../azure-ai-search/azure-ai-search";
import { CreateCitations, FormatCitations } from "../citation-service";
import { logDebug, logInfo, logError, logWarn } from "@/features/common/services/logger";

export const SearchAzureAISimilarDocuments = async (req: Request) => {
  try {
    logDebug("Starting Azure AI Search similarity search");
    
    const body = await req.json();
    const search = body.search as string;
    logDebug("Search query", { search });

    const vectors = req.headers.get("vectors") as string;
    const apiKey = req.headers.get("apiKey") as string;
    const searchName = req.headers.get("searchName") as string;
    const indexName = req.headers.get("indexName") as string;
    const userId = req.headers.get("authorization") as string;
    
    logDebug("Search parameters", { 
      searchName, 
      indexName, 
      vectorCount: vectors?.split(",").length || 0,
      hasApiKey: !!apiKey,
      hasUserId: !!userId 
    });

    logInfo("Executing similarity search via ExtensionSimilaritySearch");
    const result = await ExtensionSimilaritySearch({
      apiKey,
      searchName,
      indexName,
      vectors: vectors.split(","),
      searchText: search,
    });

    if (result.status !== "OK") {
      logError("Failed to retrieve documents from Azure AI Search", { errors: result.errors });
      return new Response(JSON.stringify(result));
    }
    
    logInfo("Successfully retrieved documents from Azure AI Search", { 
      documentCount: result.response?.length || 0 
    });

    logDebug("Formatting citations and removing embeddings");
    const withoutEmbedding = FormatCitations(result.response);
    
    logInfo("Creating citations for retrieved documents");
    const citationResponse = await CreateCitations(withoutEmbedding, userId);

    // only get the citations that are ok
    const allCitations = [];
    let successfulCitations = 0;
    let failedCitations = 0;
    
    for (const citation of citationResponse) {
      if (citation.status === "OK") {
        allCitations.push({
          id: citation.response.id,
          content: citation.response.content,
        });
        successfulCitations++;
      } else {
        logWarn("Citation creation failed", { 
          error: citation.errors 
        });
        failedCitations++;
      }
    }
    
    logInfo("Citation processing completed", { 
      total: citationResponse.length,
      successful: successfulCitations,
      failed: failedCitations 
    });

    logDebug("Returning citations", { citationCount: allCitations.length });
    return new Response(JSON.stringify(allCitations));
  } catch (e) {
    logError("Unexpected error in SearchAzureAISimilarDocuments", {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined
    });
    return new Response(JSON.stringify(e));
  }
};
