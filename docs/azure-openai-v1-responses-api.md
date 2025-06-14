# Azure OpenAI v1 Responses API Integration

This document explains how to use the new Azure OpenAI v1 Responses API features that have been integrated into Azure Chat.

## Overview

The v1 Responses API is the next generation of Azure OpenAI APIs that provides:

- **Always up-to-date**: No need to update API versions monthly
- **OpenAI client compatibility**: Minimal code changes between OpenAI and Azure OpenAI
- **Advanced features**: Reasoning summaries, background tasks, image generation, MCP servers, and more
- **Stateful responses**: Chain responses together for complex workflows

## Supported Models

### Standard Models (using v1 API)
- **gpt-4o**: Most capable multimodal model
- **gpt-4o-mini**: Fast and efficient for everyday tasks
- **gpt-4.1**: Latest GPT-4.1 with enhanced capabilities
- **gpt-4.1-mini**: Efficient version of GPT-4.1
- **gpt-4.1-nano**: Ultra-fast and lightweight

### Reasoning Models (with summary support)
- **o3**: Advanced reasoning with step-by-step thinking
- **o4-mini**: Efficient reasoning with detailed summaries

### Specialized Models
- **gpt-image-1**: Image generation and editing
- **computer-use-preview**: Computer interaction capabilities (experimental)

## Environment Configuration

Add these new environment variables to your `.env.local`:

```bash
# New v1 API model deployments
AZURE_OPENAI_API_GPT41_DEPLOYMENT_NAME=gpt-41
AZURE_OPENAI_API_GPT41_MINI_DEPLOYMENT_NAME=gpt-41-mini
AZURE_OPENAI_API_GPT41_NANO_DEPLOYMENT_NAME=gpt-41-nano
AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME=gpt-image-1
AZURE_OPENAI_API_O3_DEPLOYMENT_NAME=o3
AZURE_OPENAI_API_O4_MINI_DEPLOYMENT_NAME=o4-mini
AZURE_OPENAI_API_COMPUTER_USE_DEPLOYMENT_NAME=computer-use-preview
```

## Key Features

### 1. Reasoning Summaries

Reasoning models (o3, o4-mini) provide summaries of their thinking process:

```typescript
// Automatic reasoning summaries
const response = await ChatApiResponses({
  chatThread,
  userMessage: "Explain quantum computing",
  history: [],
  signal: abortSignal,
  reasoningEffort: "medium" // low, medium, high
});
```

The reasoning content is automatically captured and displayed in the chat interface.

### 2. Background Tasks

For long-running tasks that might take several minutes:

```typescript
const backgroundResponse = await createBackgroundResponse({
  chatThread,
  userMessage: "Write a comprehensive research paper",
  history: [],
  signal: abortSignal,
  background: true
});

// Poll for completion
const status = await retrieveResponse(backgroundResponse.id);
```

### 3. Response Chaining

Chain responses together to maintain context across multiple interactions:

```typescript
const firstResponse = await ChatApiResponses({
  chatThread,
  userMessage: "What is machine learning?",
  history: [],
  signal: abortSignal
});

const secondResponse = await chainResponse({
  chatThread,
  userMessage: "Explain it for beginners",
  history: [],
  signal: abortSignal,
  previousResponseId: firstResponse.id
});
```

### 4. Image Generation

Generate and edit images using the gpt-image-1 model:

```typescript
const imageResponse = await createImageGenerationResponse({
  chatThread: { ...chatThread, selectedModel: "gpt-image-1" },
  userMessage: "Generate a sunset over mountains",
  history: [],
  signal: abortSignal
});
```

Features include:
- Multi-turn image editing
- Streaming partial images during generation
- Support for image inputs (base64 or file IDs)

### 5. Function Calling

Enhanced function calling with the Responses API:

```typescript
const tools = [
  {
    type: "function",
    name: "get_weather",
    description: "Get weather information",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string" }
      },
      required: ["location"]
    }
  }
];

const response = await ChatApiResponses({
  chatThread,
  userMessage: "What's the weather in Paris?",
  history: [],
  signal: abortSignal,
  tools
});
```

### 6. MCP (Model Context Protocol) Servers

Connect to remote MCP servers for extended capabilities:

```typescript
const mcpServers = [
  {
    label: "github",
    url: "https://gitmcp.io/Azure/azure-rest-api-specs",
    requireApproval: "never", // or "always"
    headers: {
      "Authorization": "Bearer YOUR_TOKEN"
    }
  }
];

const response = await createResponseWithMCP({
  chatThread,
  userMessage: "What's in this repository?",
  history: [],
  signal: abortSignal,
  mcpServers
});
```

### 7. Multimodal Input

Support for images alongside text:

```typescript
const response = await ChatApiResponses({
  chatThread,
  userMessage: "What's in this image?",
  history: [],
  signal: abortSignal,
  multiModalImage: "data:image/jpeg;base64,..." // or image URL
});
```

## Streaming Events

The v1 API provides rich streaming events:

- `response.output_text.delta`: Text content streaming
- `response.reasoning_summary_text.delta`: Reasoning summaries
- `response.image_generation_call.partial_image`: Partial images
- `response.function_call.done`: Function call results
- `response.mcp_approval_request`: MCP server approval requests
- `response.queued`/`response.in_progress`: Background task status

## Response Management

### Retrieve Response
```typescript
const response = await retrieveResponse(responseId);
```

### Delete Response
```typescript
await deleteResponse(responseId);
```

### Cancel Background Response
```typescript
await cancelResponse(responseId);
```

### List Input Items
```typescript
const inputs = await listInputItems(responseId);
```

## Migration from Legacy API

### Before (Legacy API)
```typescript
const openai = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  apiVersion: "2025-04-01-preview",
  azure_endpoint: "https://resource.openai.azure.com"
});

const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [...],
  stream: true
});
```

### After (v1 Responses API)
```typescript
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: "https://resource.openai.azure.com/openai/v1/",
  defaultQuery: { "api-version": "preview" }
});

const response = await openai.responses.create({
  model: "gpt-4o",
  input: [...],
  stream: true
});
```

## Best Practices

1. **Model Selection**: Use the appropriate model for your use case
   - `gpt-4o` for complex multimodal tasks
   - `gpt-4.1-nano` for fast, simple responses
   - `o3`/`o4-mini` for reasoning tasks

2. **Reasoning Effort**: Adjust based on task complexity
   - `low`: Simple questions
   - `medium`: Standard reasoning tasks
   - `high`: Complex problem-solving

3. **Background Tasks**: Use for operations that might take >30 seconds

4. **Response Chaining**: Maintain context across related interactions

5. **Error Handling**: Handle approval requests for MCP servers

6. **Token Management**: Monitor usage with the built-in token service

## Troubleshooting

### Common Issues

1. **Model Not Available**: Ensure the deployment exists in your Azure OpenAI resource
2. **API Version**: Use `"preview"` for the v1 API
3. **MCP Approval**: Handle approval requests in your UI
4. **Background Timeouts**: Use appropriate polling intervals

### Debug Logging

Enable detailed logging to troubleshoot issues:

```typescript
console.log("🚀 Creating responses stream with options:", {
  model: requestOptions.model,
  hasReasoning: !!requestOptions.reasoning,
  hasTools: tools.length > 0,
  background: requestOptions.background
});
```

## Region Availability

The Responses API is available in these regions:
- australiaeast
- eastus
- eastus2
- francecentral
- japaneast
- norwayeast
- southindia
- swedencentral
- uaenorth
- uksouth
- westus
- westus3

Ensure your Azure OpenAI resource is deployed in a supported region.

## Limitations

- Web search tool not currently supported
- Fine-tuned models not supported
- Image generation via streaming has known performance issues
- File upload for images coming soon
- Background mode has higher time-to-first-token latency

## Support

For issues with the v1 Responses API integration:

1. Check the console logs for detailed error messages
2. Verify your environment variables are correctly set
3. Ensure your Azure OpenAI resource supports the v1 API
4. Check that your selected model is deployed and available

## Examples

See the `test-chat-api.js` file for working examples of all features.
