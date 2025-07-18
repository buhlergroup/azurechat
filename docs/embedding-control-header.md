# Embedding Control Header

## Overview

The Azure Chat application now supports controlling whether embeddings are created during tool calls through an internal header parameter. This allows you to optimize performance and costs by avoiding unnecessary embedding creation when it's not needed. The header is used internally by Bühler Chat GPT and is not passed to external services like Azure Search.

## Problem

Previously, embeddings were created in two different places:
1. In the `searchDocuments` function in the chat API
2. In the `SimilaritySearch` function in Azure AI Search

This could lead to inconsistent behavior and unnecessary embedding creation.

## Solution

A new header parameter `x-create-embedding` has been added to control embedding creation during tool calls.

## Usage

### For Custom Extensions

When creating a custom extension, you can add a header with the key `x-create-embedding` and value `false` to disable embedding creation:

```json
{
  "name": "my-custom-search",
  "description": "Custom search function",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query"
      }
    }
  },
  "headers": [
    {
      "key": "x-create-embedding",
      "value": "false"
    }
  ]
}
```

### For Azure Search Extensions

Azure Search extensions automatically support the `x-create-embedding` header. The header is included by default in the Azure AI Search extension template with a value of `true`. This header is used internally by Bühler Chat GPT and is not passed to Azure Search.

- **Default behavior**: Bühler Chat GPT creates embeddings for the search query (header value: `true`)
- **To disable embedding creation**: Set the header `x-create-embedding: false`

Example request headers for Azure Search extension:
```
vectors: field1,field2,field3
apiKey: your-api-key
searchName: your-search-service
indexName: your-index-name
x-create-embedding: true   // Internal: Bühler Chat GPT creates embeddings
x-create-embedding: false  // Internal: disable embedding creation
```

### Default Behavior

- **Default behavior**: Bühler Chat GPT creates embeddings (when header is not present or set to any value other than `false`)
- **When header is set to `false`**: Embeddings will not be created
- This applies to both the `searchDocuments` function and Azure Search extensions

### Implementation Details

1. **Function Registry**: The `searchDocuments` function now checks for the `x-create-embedding` header
2. **Azure AI Search**: 
   - The `SimilaritySearch` function accepts a `shouldCreateEmbedding` parameter
   - The `ExtensionSimilaritySearch` function accepts a `shouldCreateEmbedding` parameter
3. **RAG Extension**: The Azure Search RAG extension checks for the `x-create-embedding` header (internal only)
4. **Conversation Context**: Headers from extensions are passed through the conversation context
5. **Dynamic Functions**: Headers are merged from both the function definition and conversation context
6. **Internal Header**: The `x-create-embedding` header is used internally and not passed to external services

### Code Changes

#### Function Registry (`function-registry.ts`)
- Updated `executeFunction` to accept headers in context
- Modified `searchDocuments` to check for `x-create-embedding` header
- Updated `registerDynamicFunction` to merge headers

#### Azure AI Search (`azure-ai-search.ts`)
- Modified `SimilaritySearch` to accept `shouldCreateEmbedding` parameter
- Modified `ExtensionSimilaritySearch` to accept `shouldCreateEmbedding` parameter
- Conditional embedding creation based on the parameter

#### Conversation Manager (`conversation-manager.ts`)
- Updated context interface to include headers
- Pass headers to function execution

#### Chat API Response (`chat-api-response.ts`)
- Modified `_getAvailableTools` to return extension headers
- Pass extension headers to conversation context

#### RAG Extension (`chat-api-rag-extension.ts`)
- Added header checking for `x-create-embedding`
- Pass `shouldCreateEmbedding` parameter to `ExtensionSimilaritySearch`

#### Extension Templates (`extension-store.ts`, `ai-search-issues.tsx`)
- Added `x-create-embedding: true` to default extension headers
- Added `x-create-embedding: true` to Azure AI Search extension template

## Benefits

1. **Performance**: Avoid unnecessary embedding creation when not needed
2. **Cost Optimization**: Reduce Azure OpenAI API calls for embeddings
3. **Flexibility**: Allow extensions to control embedding behavior
4. **Backward Compatibility**: Default behavior remains unchanged

## Example Use Cases

1. **Simple Text Search**: When you only need keyword-based search without semantic similarity
2. **Pre-computed Embeddings**: When embeddings are already available in the search index
3. **Cost-Sensitive Operations**: When you want to minimize API calls to Azure OpenAI

## Migration

No migration is required for existing extensions. The default behavior remains the same - embeddings will be created unless explicitly disabled via the header. 