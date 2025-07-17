# OpenAI Responses API Streaming Implementation

This document describes the implementation of Server Sent Events (SSE) streaming using the OpenAI Responses API, as recommended in the OpenAI SDK migration guide.

## Overview

The Azure Chat application now supports two streaming approaches:

1. **OpenAI Responses API** (New) - For reasoning models (o3, o3-pro, o4-mini)
2. **Chat Completions API** (Legacy) - For non-reasoning models and other scenarios like RAG and multimodal

## Implementation Details

### New Responses API Streaming

The new implementation follows the pattern recommended by OpenAI:

```typescript
import OpenAI from 'openai';

const client = new OpenAI();

const stream = await client.responses.create({
  model: 'gpt-4o',
  input: 'Say "Sheep sleep deep" ten times fast!',
  stream: true,
});

for await (const event of stream) {
  console.log(event);
}
```

### Key Files

1. **`chat-api-responses.ts`** - Creates the OpenAI Responses API stream
2. **`openai-responses-stream.ts`** - Processes SSE events and converts to ReadableStream
3. **`chat-api.ts`** - Main entry point that decides which streaming approach to use

### Event Types Handled

The new streaming implementation handles these SSE event types:

- `response.queued` - Response has been queued
- `response.output_item.added` - New output item added
- `response.text.delta` - Incremental text content
- `response.text.done` - Text content complete
- `response.reasoning_summary_text.delta` - Incremental reasoning summary
- `response.reasoning_summary_text.done` - Reasoning summary complete
- `response.output_item.done` - Output item complete
- `response.done` - Entire response complete
- `error` - Error occurred

### Reasoning Support

For reasoning models (o3, o3-pro, o4-mini), the implementation:

1. Configures reasoning effort level (`low`, `medium`, `high`)
2. Requests automatic summary generation (`summary: "auto"`)
3. Streams reasoning summaries as they become available
4. Combines multiple summary parts if needed
5. Saves reasoning content alongside the final message

### Backward Compatibility

The implementation maintains backward compatibility by:

- Using the new Responses API for all reasoning models (o3, o3-pro, o4-mini)
- Falling back to Chat Completions API for non-reasoning models
- Preserving existing event types and response formats
- Maintaining the same client-side streaming interface

### Configuration

The system automatically determines which API to use based on:

```typescript
const useResponsesAPI = modelConfig.supportsReasoning;
```

This ensures:
- Reasoning models (o3, o3-pro, o4-mini) always use the new Responses API
- Extensions work seamlessly with the Responses API
- RAG and multimodal scenarios use Chat Completions API for non-reasoning models
- No breaking changes for existing functionality

### Benefits

1. **Better Reasoning Support** - Native support for reasoning summaries
2. **Improved Streaming** - More granular event types
3. **Future-Proof** - Aligned with OpenAI's recommended approach
4. **Seamless Migration** - No client-side changes required

### Usage Examples

#### Simple Reasoning Query
```typescript
// Automatically uses Responses API for o3/o3-pro/o4-mini models
const response = await ChatAPIEntry({
  id: threadId,
  message: "Explain quantum computing step by step",
  selectedModel: "o3",
  reasoningEffort: "high"
}, signal);
```

#### With Extensions
```typescript
// Uses Responses API for reasoning models even with extensions
const response = await ChatAPIEntry({
  id: threadId,
  message: "Search for recent AI news",
  selectedModel: "o3",
  // Extensions work seamlessly with Responses API
}, signal);
```

## Migration Notes

- No client-side changes required
- Existing streaming consumers continue to work unchanged
- New reasoning capabilities are automatically available
- Performance improvements for reasoning models
- Better error handling and event granularity

## Future Enhancements

- Support for tool calling in Responses API
- Enhanced multimodal support
- Additional reasoning configuration options
- Performance optimizations for large responses
