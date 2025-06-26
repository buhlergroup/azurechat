"use server";
import "server-only";

import { uniqueId } from "@/features/common/util";
import { OpenAIDALLEInstance } from "@/features/common/services/openai";
import { GetImageUrl, UploadImageToStore } from "../chat-image-service";
import { SimilaritySearch } from "../azure-ai-search/azure-ai-search";
import { CreateCitations, FormatCitations } from "../citation-service";
import { userHashedId } from "@/features/auth-page/helpers";
import { skip } from "node:test";

// Type definitions for function calling
export interface FunctionDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
    additionalProperties: false;
  };
  strict: true;
}

export interface FunctionCall {
  name: string;
  arguments: Record<string, any>;
  call_id: string;
}

export interface FunctionResult {
  call_id: string;
  output: string;
}

// Function registry - maps function names to implementations
const functionRegistry = new Map<string, (args: any, context: any) => Promise<any>>();

// Helper function to register a function
export async function registerFunction(
  name: string, 
  implementation: (args: any, context: any) => Promise<any>
) {
  functionRegistry.set(name, implementation);
}

// Helper function to execute a function call
export async function executeFunction(
  functionCall: FunctionCall, 
  context: { threadId: string; userMessage: string; signal: AbortSignal }
): Promise<FunctionResult> {
  const implementation = functionRegistry.get(functionCall.name);
  
  if (!implementation) {
    return {
      call_id: functionCall.call_id,
      output: JSON.stringify({ error: `Function ${functionCall.name} not found` })
    };
  }

  try {
    const result = await implementation(functionCall.arguments, context);
    return {
      call_id: functionCall.call_id,
      output: typeof result === 'string' ? result : JSON.stringify(result)
    };
  } catch (error) {
    return {
      call_id: functionCall.call_id,
      output: JSON.stringify({ error: `Function execution failed: ${error}` })
    };
  }
}

// Built-in function implementations

// Image creation function
async function createImage(
  args: { prompt: string }, 
  context: { threadId: string; userMessage: string; signal: AbortSignal }
) {
  console.info("🎨 Creating image with DALL-E", { 
    promptLength: args.prompt?.length || 0,
    threadId: context.threadId 
  });
  console.debug("🎨 Image prompt:", args.prompt);

  if (!args.prompt) {
    throw new Error("No prompt provided");
  }

  if (args.prompt.length >= 4000) {
    throw new Error("Prompt is too long, it must be less than 4000 characters");
  }

  const openAI = OpenAIDALLEInstance();

  const response = await openAI.images.generate(
    {
      model: "dall-e-3",
      prompt: args.prompt,
      response_format: "b64_json",
    },
    {
      signal: context.signal,
    }
  );

  if (
    !response.data ||
    !Array.isArray(response.data) ||
    !response.data[0] ||
    response.data[0].b64_json === undefined
  ) {
    throw new Error("Invalid API response received");
  }

  const imageName = `${uniqueId()}.png`;

  await UploadImageToStore(
    context.threadId,
    imageName,
    Buffer.from(response.data[0].b64_json, "base64")
  );

  return {
    revised_prompt: response.data[0].revised_prompt,
    url: await GetImageUrl(context.threadId, imageName),
  };
}

// RAG search function
async function searchDocuments(
  args: { query: string; limit?: number, skip?: number }, 
  context: { threadId: string; userMessage: string; signal: AbortSignal }
) {
  console.info("🔍 Searching documents", { 
    queryLength: args.query?.length || 0,
    limit: args.limit || 10,
    skip: args.skip || 0,
    threadId: context.threadId 
  });
  console.debug("🔍 Search query:", args.query);

  const limit = args.limit || 10;
  const skip = args.skip || 0;
  const userId = await userHashedId();

  // Perform similarity search across user's documents and thread-specific documents
  const documentResponse = await SimilaritySearch(
    args.query,
    limit,
    `(user eq '${userId}' and chatThreadId eq '${context.threadId}') or (chatThreadId eq null and user eq '${userId}')`,
    skip
  );

  if (documentResponse.status !== "OK") {
    console.error("🔴 Document search failed:", documentResponse.errors);
    return {
      query: args.query,
      documents: [],
      summary: `Search failed: ${documentResponse.errors?.[0]?.message || "Unknown error"}`,
      error: true
    };
  }
  
  console.info("✅ Document search completed", { 
    resultCount: documentResponse.response?.length || 0 
  });

  const withoutEmbedding = FormatCitations(documentResponse.response);
  const citationResponse = await CreateCitations(withoutEmbedding);

  const documents: Array<{
    id: string;
    content: string;
    metadata: string;
    relevanceScore?: number;
  }> = [];
  
  citationResponse.forEach((c, index) => {
    if (c.status === "OK") {
      documents.push({
        id: c.response.id,
        content: c.response.content.document.pageContent,
        metadata: c.response.content.document.metadata,
        relevanceScore: documentResponse.response[index]?.score || 0,
      });
    }
  });

  // Create a comprehensive response with context
  const contextText = documents
    .map((doc, index) => {
      return `[Document ${index + 1}] ${doc.metadata}\nContent: ${doc.content.substring(0, 500)}${doc.content.length > 500 ? '...' : ''}\n`;
    })
    .join('\n---\n');

  return {
    query: args.query,    documents: documents,
    contextText: contextText,
    summary: `Found ${documents.length} relevant documents for: "${args.query}". Use the document content to provide detailed answers.`,
    documentCount: documents.length
  };
}

// Register built-in functions (will be called when needed)
async function ensureBuiltInFunctionsRegistered() {
  if (!functionRegistry.has("create_image")) {
    await registerFunction("create_image", createImage);
  }
  if (!functionRegistry.has("search_documents")) {
    await registerFunction("search_documents", searchDocuments);
  }
}

// Get all available function definitions
export async function getAvailableFunctions(): Promise<FunctionDefinition[]> {
  // Ensure built-in functions are registered
  await ensureBuiltInFunctionsRegistered();
  
  // Define the base schemas for built-in functions
  const builtInFunctions = [
    {
      type: "function" as const,
      name: "create_image",
      description: "Create an image using DALL-E 3. Only use this when the user explicitly asks to create, generate, or make an image.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "A detailed description of the image to create. Be descriptive and specific."
          }
        }
      },
      strict: true as const
    },
    {
      type: "function" as const, 
      name: "search_documents",
      description: "Search through attached documents to the chat thread to find relevant information. Use this when the user asks questions that might be answered by their documents. Use multiple iterations in combination with limit and skip parameters to find the best answer if required.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant documents and information. Should be the raw question or a summarized version which is used for semantic search."
          },
          limit: {
            type: ["number", "null"],
            description: "Maximum number of documents to return (default: 10)"
          },
          skip: {
            type: ["number", "null"],
            description: "Number of documents to skip (default: 0). This is useful for pagination if the question cannot be answered with the first batch of documents."
          }  
        }
      },
      strict: true as const
    }
  ];

  // Apply schema validation to all built-in functions
  return builtInFunctions.map(func => ({
    ...func,
    parameters: validateAndFixSchema(func.parameters)
  }));
}

// Helper function to validate and fix function schemas for Azure OpenAI strict mode
function validateAndFixSchema(schema: any): any {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  // Create a deep copy to avoid mutating the original
  const fixedSchema = JSON.parse(JSON.stringify(schema));

  // Ensure additionalProperties is set to false for all object types
  if (fixedSchema.type === 'object') {
    fixedSchema.additionalProperties = false;
    
    // Ensure all properties are marked as required for OpenAI compatibility
    if (fixedSchema.properties) {
      const propertyKeys = Object.keys(fixedSchema.properties);
      if (propertyKeys.length > 0) {
        fixedSchema.required = propertyKeys;
      }
      
      // Recursively fix nested properties
      for (const key in fixedSchema.properties) {
        fixedSchema.properties[key] = validateAndFixSchema(fixedSchema.properties[key]);
      }
    }
  }

  // Handle arrays
  if (fixedSchema.type === 'array' && fixedSchema.items) {
    fixedSchema.items = validateAndFixSchema(fixedSchema.items);
  }

  return fixedSchema;
}

// Add support for dynamic extensions
export async function registerDynamicFunction(
  name: string,
  description: string,
  parameters: any,
  endpoint: string,
  method: string = "POST",
  headers: Record<string, string> = {}
) {
  // Validate and fix the parameters schema to ensure it meets Azure OpenAI strict mode requirements
  const validatedParameters = validateAndFixSchema(parameters);
  
  console.debug("🔧 Registering dynamic function", { 
    name, 
    method, 
    endpoint: endpoint.substring(0, 50) + "...",
    hasHeaders: Object.keys(headers).length > 0 
  });
  
  const implementation = async (args: any, context: any) => {
    console.debug("🔧 Calling dynamic function", { 
      name, 
      argsKeys: Object.keys(args || {}),
      contextKeys: Object.keys(context || {}) 
    });

    let url = endpoint;
    const requestInit: RequestInit = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        'authorization': await userHashedId(), // Add user context
      },
      cache: "no-store",
    };

    // Handle query parameters
    if (args.query) {
      const queryParams = new URLSearchParams();
      for (const [key, value] of Object.entries(args.query)) {
        queryParams.append(key, String(value));
      }
      url += (url.includes('?') ? '&' : '?') + queryParams.toString();
    }

    // Handle body parameters
    if (args.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      requestInit.body = JSON.stringify(args.body);
    }

    const response = await fetch(url, requestInit);

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }    const result = await response.json();
    return result;
  };

  await registerFunction(name, implementation);

  return {
    type: "function" as const,
    name,
    description,
    parameters: validateAndFixSchema(parameters),
    strict: true
  };
}
