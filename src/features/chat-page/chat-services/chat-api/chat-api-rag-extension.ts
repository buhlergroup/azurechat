import { ExtensionSimilaritySearch } from "../azure-ai-search/azure-ai-search";
import { CreateCitations, FormatCitations } from "../citation-service";

export const SearchAzureAISimilarDocuments = async (req: Request) => {
  try {
    console.debug("🔍 Starting Azure AI Search similarity search");
    
    const body = await req.json();
    const search = body.search as string;
    console.debug("🔍 Search query:", search);

    const vectors = req.headers.get("vectors") as string;
    const apiKey = req.headers.get("apiKey") as string;
    const searchName = req.headers.get("searchName") as string;
    const indexName = req.headers.get("indexName") as string;
    const userId = req.headers.get("authorization") as string;
    
    console.debug("🔍 Search parameters:", { 
      searchName, 
      indexName, 
      vectorCount: vectors?.split(",").length || 0,
      hasApiKey: !!apiKey,
      hasUserId: !!userId 
    });

    console.info("📡 Executing similarity search via ExtensionSimilaritySearch");
    const result = await ExtensionSimilaritySearch({
      apiKey,
      searchName,
      indexName,
      vectors: vectors.split(","),
      searchText: search,
    });

    if (result.status !== "OK") {
      console.error("🔴 Failed to retrieve documents from Azure AI Search", result.errors);
      return new Response(JSON.stringify(result));
    }
    
    console.info("✅ Successfully retrieved documents from Azure AI Search", { 
      documentCount: result.response?.length || 0 
    });

    console.debug("🔄 Formatting citations and removing embeddings");
    const withoutEmbedding = FormatCitations(result.response);
    
    console.info("📝 Creating citations for retrieved documents");
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
        console.warn("⚠️ Citation creation failed", { 
          error: citation.errors 
        });
        failedCitations++;
      }
    }
    
    console.info("📊 Citation processing completed", { 
      total: citationResponse.length,
      successful: successfulCitations,
      failed: failedCitations 
    });

    console.debug("✅ Returning citations", { citationCount: allCitations.length });
    return new Response(JSON.stringify(allCitations));
  } catch (e) {
    console.error("🔴 Unexpected error in SearchAzureAISimilarDocuments", {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined
    });
    return new Response(JSON.stringify(e));
  }
};
