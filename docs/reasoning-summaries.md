# Reasoning Summaries Implementation

This document describes the implementation of OpenAI's reasoning summaries feature in the Azure Chat application.

## Overview

Reasoning summaries provide access to the model's reasoning process for OpenAI's reasoning models (o1, o3, o3-mini, o4-mini). The implementation uses the `summary: "auto"` parameter to automatically get the best available summary format.

## Supported Models

The following models support reasoning summaries:

- **o1**: Advanced reasoning model with detailed and concise summarizers
- **o3**: Latest reasoning model with detailed and concise summarizers  
- **o3-mini**: Efficient reasoning model with detailed and concise summarizers
- **o4-mini**: Latest mini reasoning model with detailed summarizer support

## Implementation Details

### 1. Model Configuration

Models are configured in `src/features/chat-page/chat-services/models.ts`:

```typescript
export const MODEL_CONFIGS: Record<ChatModel, ModelConfig> = {
  "o1": {
    id: "o1",
    name: "O1-Reasoning",
    description: "Advanced reasoning, complex problem solving",
    getInstance: () => OpenAIReasoningInstance(),
    supportsReasoning: true,
    supportedSummarizers: ["detailed", "concise"]
  },
  // ... other models
};
```

### 2. API Request Configuration

The reasoning configuration is added to OpenAI API requests:

```typescript
// Add reasoning summary configuration
requestOptions.reasoning = {
  effort: reasoningEffort || "medium",
  summary: "auto" // Auto gives the best available summary (detailed > concise > none)
};
```

This configuration is applied in:
- `chat-api-extension.ts` - For general chat with extensions
- `chat-api-rag.ts` - For chat with documents/RAG
- `chat-api-multimodal.tsx` - For multimodal chat with images

### 3. Response Processing

The OpenAI stream handler (`open-ai-stream.ts`) processes reasoning content from multiple possible locations in the API response:

```typescript
// Check for reasoning summary from the new API structure
if ((completion as any).reasoning?.summary) {
  currentReasoningContent = (completion as any).reasoning.summary;
  console.log("🧠 Found reasoning summary in completion.reasoning.summary");
}
// Fallback to existing reasoning content fields
else if (message.reasoning) {
  currentReasoningContent = message.reasoning;
  // ... other fallback locations
}
```

### 4. Data Storage

Reasoning content is stored in the database as part of chat messages:

```typescript
export interface ChatMessageModel {
  // ... other fields
  reasoningContent?: string;
}
```

### 5. UI Display

Reasoning content is displayed in an expandable accordion in the message component (`message-content.tsx`):

```typescript
{message.reasoningContent && message.role === "assistant" && (
  <Accordion type="multiple" className="bg-background rounded-md border p-2">
    <AccordionItem value="reasoning">
      <AccordionTrigger className="text-sm py-1 items-center gap-2">
        <div className="flex gap-2 items-center">
          <Brain size={18} strokeWidth={1.4} className="text-blue-500" />
          Show reasoning thoughts
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="text-sm text-muted-foreground bg-slate-50 dark:bg-slate-900 p-3 rounded-md">
          <Markdown content={message.reasoningContent} onCitationClick={CitationAction} />
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
)}
```

## Usage

### 1. Environment Setup

Ensure you have the reasoning deployment configured in your environment variables:

```env
AZURE_OPENAI_API_REASONING_DEPLOYMENT_NAME=your-reasoning-deployment
```

### 2. Model Selection

Users can select reasoning models from the model selector in the chat interface. The reasoning effort can be adjusted using the reasoning effort selector.

### 3. Viewing Reasoning

When using a reasoning model, users will see a "Show reasoning thoughts" accordion above the assistant's response. Clicking it reveals the model's reasoning process.

## API Parameters

### Reasoning Configuration

```typescript
reasoning: {
  effort: "low" | "medium" | "high",
  summary: "auto" | "detailed" | "concise" | "none"
}
```

- **effort**: Controls how much computational effort the model puts into reasoning
- **summary**: Controls the level of detail in reasoning summaries
  - `"auto"`: Automatically selects the best available summarizer for the model
  - `"detailed"`: Provides comprehensive reasoning details
  - `"concise"`: Provides condensed reasoning summaries
  - `"none"`: Disables reasoning summaries

## New Event-Based API Structure

OpenAI has introduced a new event-based structure for reasoning summaries that provides more granular control and better streaming support:

### Event Types

#### `response.reasoning_summary_text.delta`
Emitted when a delta is added to a reasoning summary text during streaming.

**Properties:**
- `type`: Always `"response.reasoning_summary_text.delta"`
- `item_id`: The ID of the item this summary text delta is associated with
- `output_index`: The index of the output item this summary text delta is associated with
- `sequence_number`: The sequence number of this event
- `summary_index`: The index of the summary part within the reasoning summary
- `delta`: The text delta that was added to the summary

**Example:**
```json
{
  "type": "response.reasoning_summary_text.delta",
  "item_id": "rs_6806bfca0b2481918a5748308061a2600d3ce51bdffd5476",
  "output_index": 0,
  "summary_index": 0,
  "delta": "**Responding to a greeting**\n\nThe user just said, \"Hello!\" So, it seems I need to engage...",
  "sequence_number": 1
}
```

#### `response.reasoning_summary_text.done`
Emitted when a reasoning summary text is completed.

**Properties:**
- `type`: Always `"response.reasoning_summary_text.done"`
- `item_id`: The ID of the item this summary text is associated with
- `output_index`: The index of the output item this summary text is associated with
- `sequence_number`: The sequence number of this event
- `summary_index`: The index of the summary part within the reasoning summary
- `text`: The full text of the completed reasoning summary

**Example:**
```json
{
  "type": "response.reasoning_summary_text.done",
  "item_id": "rs_6806bfca0b2481918a5748308061a2600d3ce51bdffd5476",
  "output_index": 0,
  "summary_index": 0,
  "text": "Complete reasoning summary text here...",
  "sequence_number": 2
}
```

### Implementation Considerations

The current implementation handles reasoning content from various response fields for backward compatibility. To support the new event-based structure, the stream handler should be updated to:

1. **Listen for reasoning events**: Handle `response.reasoning_summary_text.delta` and `response.reasoning_summary_text.done` events
2. **Accumulate deltas**: Build the complete reasoning summary from streaming deltas
3. **Maintain compatibility**: Continue supporting the existing field-based approach as fallback
4. **Handle multiple summaries**: Support multiple summary parts via `summary_index`

### Migration Path

The implementation should support both the legacy field-based approach and the new event-based structure:

```typescript
// New event-based handling
if (event.type === 'response.reasoning_summary_text.delta') {
  // Accumulate reasoning deltas
  reasoningSummaries[event.summary_index] = 
    (reasoningSummaries[event.summary_index] || '') + event.delta;
}

if (event.type === 'response.reasoning_summary_text.done') {
  // Complete reasoning summary available
  const completeReasoning = event.text;
}

// Fallback to legacy field-based approach
if (!reasoningContent && message.reasoning) {
  reasoningContent = message.reasoning;
}
```

## Benefits

1. **Transparency**: Users can see how the model arrived at its conclusions
2. **Learning**: Users can understand the reasoning process for educational purposes
3. **Debugging**: Developers can troubleshoot model responses by examining reasoning
4. **Trust**: Increased confidence in model outputs through visible reasoning

## Streaming Support

The implementation supports streaming of reasoning content, allowing users to see reasoning thoughts as they're generated in real-time.

## Organization Verification

Note: For the latest reasoning models, organization verification may be required on the OpenAI platform settings page to ensure safe deployment.

## Troubleshooting

### Common Issues

1. **No reasoning content displayed**: Ensure you're using a supported reasoning model
2. **Empty reasoning summaries**: Check that the model deployment supports reasoning
3. **API errors**: Verify organization verification is complete for latest models

### Debug Logging

The implementation includes comprehensive debug logging to help troubleshoot reasoning content extraction:

```typescript
console.log("🔍 OpenAI Response Structure:", {
  messageKeys: Object.keys(message),
  choiceKeys: Object.keys(choice),
  hasReasoning: !!message.reasoning,
  hasReasoningContent: !!message.reasoning_content,
  hasThoughts: !!message.thoughts,
  choiceHasReasoning: !!choice.reasoning,
  completionKeys: Object.keys(completion),
  hasReasoningSummary: !!(completion as any).reasoning?.summary,
  reasoningKeys: (completion as any).reasoning ? Object.keys((completion as any).reasoning) : []
});
```

This helps identify where reasoning content is located in the API response structure.
