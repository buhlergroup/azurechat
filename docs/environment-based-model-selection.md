# Environment-Based Model Selection

This feature automatically enables/disables AI models in the chat interface based on environment variable configuration. Models will only appear in the model selector if their corresponding deployment environment variables are set.

## How It Works

### Model Configuration
Each model in `src/features/chat-page/chat-services/models.ts` has a `deploymentName` property that references an environment variable:

```typescript
export const MODEL_CONFIGS: Record<ChatModel, ModelConfig> = {
  "o3": {
    id: "o3",
    name: "o3 Reasoning",
    description: "Advanced reasoning model with step-by-step thinking",
    getInstance: () => OpenAIV1ReasoningInstance(),
    supportsReasoning: true,
    supportsResponsesAPI: true,
    supportedSummarizers: ["detailed", "concise", "auto"],
    deploymentName: process.env.AZURE_OPENAI_API_O3_DEPLOYMENT_NAME // ← This determines availability
  },
  // ... other models
};
```

### Environment Variables
The following environment variables control model availability:

| Model | Environment Variable |
|-------|---------------------|
| GPT-4o | `AZURE_OPENAI_API_DEPLOYMENT_NAME` |
| GPT-4o Mini | `AZURE_OPENAI_API_MINI_DEPLOYMENT_NAME` |
| GPT-4.1 | `AZURE_OPENAI_API_GPT41_DEPLOYMENT_NAME` |
| GPT-4.1 Mini | `AZURE_OPENAI_API_GPT41_MINI_DEPLOYMENT_NAME` |
| GPT-4.1 Nano | `AZURE_OPENAI_API_GPT41_NANO_DEPLOYMENT_NAME` |
| GPT Image 1 | `AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME` |
| o3 | `AZURE_OPENAI_API_O3_DEPLOYMENT_NAME` |
| o3-Pro | `AZURE_OPENAI_API_O3_PRO_DEPLOYMENT_NAME` |
| o4-Mini | `AZURE_OPENAI_API_O4_MINI_DEPLOYMENT_NAME` |
| Computer Use Preview | `AZURE_OPENAI_API_COMPUTER_USE_DEPLOYMENT_NAME` |

### Availability Logic
A model is considered "available" if:
1. Its corresponding environment variable is set
2. The environment variable value is not empty or just whitespace

### New Functions
Three new utility functions have been added to `models.ts`:

#### `getAvailableModels()`
Returns only the models that have their deployment environment variables configured.

```typescript
const availableModels = getAvailableModels();
// Returns: Record<ChatModel, ModelConfig> with only available models
```

#### `getAvailableModelIds()`
Returns an array of available model IDs.

```typescript
const modelIds = getAvailableModelIds();
// Returns: ChatModel[] - e.g., ["o3", "gpt-4.1"]
```

#### `isModelAvailable(modelId)`
Checks if a specific model is available.

```typescript
const isO3Available = isModelAvailable("o3");
// Returns: boolean
```

## Usage Examples

### Example 1: Only o3 Model Available
```bash
# .env.local
AZURE_OPENAI_API_O3_DEPLOYMENT_NAME=o3
# All other model environment variables are unset
```

**Result**: Only the o3 model appears in the model selector.

### Example 2: Multiple Models Available
```bash
# .env.local
AZURE_OPENAI_API_GPT41_DEPLOYMENT_NAME=gpt-4.1
AZURE_OPENAI_API_GPT41_MINI_DEPLOYMENT_NAME=gpt-4.1-mini
AZURE_OPENAI_API_O3_DEPLOYMENT_NAME=o3
```

**Result**: GPT-4.1, GPT-4.1 Mini, and o3 models appear in the selector.

### Example 3: No Models Available
```bash
# .env.local
# No model deployment environment variables set
```

**Result**: No models appear in the selector, system falls back to default behavior.

## Implementation Details

### Model Selector Component
The `ModelSelector` component now uses `getAvailableModels()` instead of showing all configured models:

```typescript
export const ModelSelector: FC<ModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
}) => {
  const availableModels = getAvailableModels(); // ← Only available models
  
  return (
    <DropdownMenu>
      {/* ... */}
      <DropdownMenuContent>
        {Object.values(availableModels).map((model) => (
          <DropdownMenuItem key={model.id}>
            {/* ... */}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
```

### Chat Store Default Model
The chat store now automatically selects the first available model as the default:

```typescript
function getDefaultModel(): ChatModel {
  const availableModels = getAvailableModelIds();
  return availableModels.length > 0 ? availableModels[0] : "gpt-4.1";
}

class ChatState {
  public selectedModel: ChatModel = getDefaultModel();
  // ...
}
```

## Benefits

1. **Automatic Configuration**: Models are automatically enabled/disabled based on deployment configuration
2. **Environment-Specific**: Different environments can have different sets of available models
3. **No Code Changes**: Adding/removing models only requires environment variable changes
4. **Fallback Handling**: System gracefully handles cases where no models are available
5. **User Experience**: Users only see models that are actually configured and available

## Testing

A test component `TestModelSelector` is available to visualize which models are available vs. configured:

- **Available Models**: Shows models that will appear in the selector (green background)
- **All Configured Models**: Shows all models with availability status (green = available, red = unavailable)

## Migration

This change is backward compatible. Existing installations will continue to work, but models will only appear if their environment variables are properly configured.

To ensure all models are available, verify that all required environment variables are set in your `.env.local` file according to your Azure OpenAI deployments.
