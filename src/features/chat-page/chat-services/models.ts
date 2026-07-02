import { ChatCompletionMessage } from "openai/resources/chat/completions";
import {
  OpenAIV1Instance,
  OpenAIV1ReasoningInstance,
} from "@/features/common/services/openai";
import { logError } from "@/features/common/services/logger";

export const DEFAULT_MODEL: ChatModel = "gpt-5.5";

export const CHAT_DOCUMENT_ATTRIBUTE = "CHAT_DOCUMENT";
export const CHAT_THREAD_ATTRIBUTE = "CHAT_THREAD";
export const MESSAGE_ATTRIBUTE = "CHAT_MESSAGE";
export const CHAT_CITATION_ATTRIBUTE = "CHAT_CITATION";

export type ChatModel =
  | "gpt-5.5"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.3-chat"
  // Foundry-hosted (OpenAI-compatible) models. Served via the "foundry"
  // provider seam, not Azure Responses. DeepSeek/Kimi double as downgrade
  // targets; Grok is a selectable option.
  | "DeepSeek-V4-Pro"
  | "Kimi-K2.6"
  | "grok-4.3"
  // Anthropic Claude models served via the Azure /anthropic surface
  // (Messages API) through the "anthropic" provider seam.
  | "claude-opus-4-8"
  | "claude-sonnet-5";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
}

/**
 * The upstream provider that serves this model. Switches the route's
 * provider-seam to a different concrete implementation:
 *
 *   - "azure":     @ai-sdk/azure → OpenAI Responses API (default).
 *   - "anthropic": @ai-sdk/anthropic → Azure /anthropic Messages API.
 *   - "foundry":   @ai-sdk/openai createOpenAI() pointed at the Bühler
 *                  Azure AI Foundry OpenAI-compatible endpoint. Chat
 *                  Completions only — no Responses-API tools/reasoning.
 *
 * Absence is treated as "azure" for backward compatibility with existing
 * MODEL_CONFIGS entries.
 */
export type ModelProvider = "azure" | "anthropic" | "foundry";

/**
 * Capability badges shown next to a model in the picker.
 *   - "vision":    accepts image input
 *   - "imageGen":  can generate images
 *   - "webSearch": can search the web
 *   - "code":      can run code (code interpreter / Python)
 * NOTE: imageGen / webSearch / code are Azure-Responses built-in tools and are
 * only callable by provider "azure" models. Anthropic/Foundry models that
 * route through Chat/Messages APIs can't invoke those built-ins.
 */
export type ModelCapability = "vision" | "imageGen" | "webSearch" | "code";

export interface ModelConfig {
  id: ChatModel;
  name: string;
  description: string;
  getInstance: () => any;
  supportsReasoning: boolean;
  supportedSummarizers?: string[];
  supportsResponsesAPI: boolean;
  supportsImageGeneration?: boolean;
  supportsComputerUse?: boolean;
  /** Optional override of the route's provider seam. Defaults to "azure". */
  provider?: ModelProvider;
  deploymentName?: string;
  defaultReasoningEffort?: ReasoningEffort;
  pricing: ModelPricing;
  contextWindow: number;
  fallbackModel?: ChatModel;
  dailyTokenLimit?: number;
  dailyCostLimit?: number;
  /**
   * When true, this model may be used as an automatic hard-cap downgrade
   * target (see downgrade-config.ts / budget-service.ts). The set of
   * eligible models is chosen cheapest-first at cap time.
   */
  hardCapEligible?: boolean;
  /**
   * When true, the model is hidden from the user-facing picker (/api/models)
   * but can still be selected programmatically as a downgrade target.
   */
  hiddenFromPicker?: boolean;
  /** Capability badges rendered in the picker (text is implicit for all). */
  capabilities?: ModelCapability[];
}

export const MODEL_CONFIGS: Record<ChatModel, ModelConfig> = {
  "gpt-5.5": {
    id: "gpt-5.5",
    name: "GPT-5.5",
    description: "Latest GPT-5.5 model with state-of-the-art capabilities",
    getInstance: () => OpenAIV1ReasoningInstance(),
    supportsReasoning: true,
    supportsResponsesAPI: true,
    supportsImageGeneration: true,
    deploymentName: process.env.AZURE_OPENAI_API_GPT55_DEPLOYMENT_NAME,
    defaultReasoningEffort: "low",
    pricing: { inputPerMillion: 5, outputPerMillion: 30.00, cachedInputPerMillion: 0.5 },
    contextWindow: 1050000,
    fallbackModel: "gpt-5.4-mini",
    capabilities: ["vision", "imageGen", "webSearch", "code"],
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    name: "GPT-5.4",
    description: "Latest GPT-5.4 model with state-of-the-art capabilities",
    getInstance: () => OpenAIV1ReasoningInstance(),
    supportsReasoning: true,
    supportsResponsesAPI: true,
    supportsImageGeneration: true,
    deploymentName: process.env.AZURE_OPENAI_API_GPT54_DEPLOYMENT_NAME,
    defaultReasoningEffort: "low",
    pricing: { inputPerMillion: 2.50, outputPerMillion: 15.00, cachedInputPerMillion: 0.25 },
    contextWindow: 1050000,
    fallbackModel: "gpt-5.4-mini",
    capabilities: ["vision", "imageGen", "webSearch", "code"],
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    description: "Fast and efficient GPT-5.4 model for everyday tasks",
    getInstance: () => OpenAIV1Instance(),
    supportsReasoning: false,
    supportsResponsesAPI: true,
    deploymentName: process.env.AZURE_OPENAI_API_GPT54_MINI_DEPLOYMENT_NAME,
    defaultReasoningEffort: "medium",
    pricing: { inputPerMillion: 0.75, outputPerMillion: 4.50, cachedInputPerMillion: 0.075 },
    contextWindow: 400000,
    hardCapEligible: true,
    capabilities: ["vision", "webSearch", "code"],
  },
  "gpt-5.3-chat": {
    id: "gpt-5.3-chat",
    name: "GPT-5.3 Chat",
    description: "GPT-5.3 Chat model optimized for conversational interactions",
    getInstance: () => OpenAIV1Instance(),
    supportsReasoning: true,
    supportsResponsesAPI: true,
    deploymentName: process.env.AZURE_OPENAI_API_GPT53_CHAT_DEPLOYMENT_NAME,
    defaultReasoningEffort: "medium",
    pricing: { inputPerMillion: 1.75, outputPerMillion: 14.00, cachedInputPerMillion: 0.175 },
    contextWindow: 128000,
    fallbackModel: "gpt-5.4-mini",
    capabilities: ["vision", "webSearch", "code"],
  },
  // ── Foundry-hosted low-cost downgrade targets ──────────────────────────
  // Served via the "foundry" provider seam (OpenAI-compatible Chat
  // Completions). Chat-only: no Responses-API tools / reasoning. Hidden from
  // the picker by default (downgrade-only). Pricing below is indicative —
  // confirm against the Bühler Foundry contract before enabling in prod.
  "DeepSeek-V4-Pro": {
    id: "DeepSeek-V4-Pro",
    name: "DeepSeek V4 Pro",
    description: "Fast, efficient general-purpose model",
    getInstance: () => {
      throw new Error(
        "Foundry models run via the provider seam (streamText), not the legacy getInstance path",
      );
    },
    provider: "foundry",
    supportsReasoning: false,
    supportsResponsesAPI: false,
    deploymentName: process.env.FOUNDRY_DEEPSEEK_DEPLOYMENT_NAME,
    pricing: { inputPerMillion: 0.30, outputPerMillion: 1.20, cachedInputPerMillion: 0.03 },
    contextWindow: 163840,
    hardCapEligible: true,
    capabilities: ["code", "imageGen"],
  },
  "Kimi-K2.6": {
    id: "Kimi-K2.6",
    name: "Kimi K2.6",
    description: "Large-context conversational model",
    getInstance: () => {
      throw new Error(
        "Foundry models run via the provider seam (streamText), not the legacy getInstance path",
      );
    },
    provider: "foundry",
    supportsReasoning: false,
    supportsResponsesAPI: false,
    deploymentName: process.env.FOUNDRY_KIMI_DEPLOYMENT_NAME,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 2.50, cachedInputPerMillion: 0.015 },
    contextWindow: 262144,
    hardCapEligible: true,
    capabilities: ["vision", "imageGen", "code"],
  },
  "grok-4.3": {
    id: "grok-4.3",
    name: "Grok 4.3",
    description: "xAI Grok 4.3 (Foundry) — reasoning model",
    getInstance: () => {
      throw new Error(
        "Foundry models run via the provider seam (streamText), not the legacy getInstance path",
      );
    },
    provider: "foundry",
    // Foundry emits the reasoning item inconsistently; no effort selector.
    supportsReasoning: false,
    supportsResponsesAPI: false,
    deploymentName: process.env.FOUNDRY_GROK_DEPLOYMENT_NAME,
    // TODO: confirm Grok pricing before relying on cost tracking (placeholder).
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0, cachedInputPerMillion: 0.75 },
    contextWindow: 256000,
  },
  // ── Anthropic Claude (Azure /anthropic Messages API) ───────────────────
  // Premium selectable models — NOT downgrade targets (Opus is pricier than
  // GPT-5.5). Served via the "anthropic" provider seam.
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    description: "Anthropic's most capable model for complex work",
    getInstance: () => {
      throw new Error(
        "Anthropic models run via the provider seam (streamText), not the legacy getInstance path",
      );
    },
    provider: "anthropic",
    supportsReasoning: true,
    supportsResponsesAPI: false,
    deploymentName: process.env.AZURE_ANTHROPIC_OPUS48_DEPLOYMENT_NAME,
    pricing: { inputPerMillion: 15.0, outputPerMillion: 75.0, cachedInputPerMillion: 1.5 },
    contextWindow: 1000000,
    // Image input + Claude's native web search/fetch (wired in the anthropic
    // seam). Code execution is deferred (needs the separate Anthropic Files
    // API). Can't call the Azure built-ins (image gen etc.).
    capabilities: ["vision", "webSearch"],
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    description: "Balanced Anthropic model — fast, strong general performance",
    getInstance: () => {
      throw new Error(
        "Anthropic models run via the provider seam (streamText), not the legacy getInstance path",
      );
    },
    provider: "anthropic",
    supportsReasoning: true,
    supportsResponsesAPI: false,
    deploymentName: process.env.AZURE_ANTHROPIC_SONNET5_DEPLOYMENT_NAME,
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0, cachedInputPerMillion: 0.3 },
    contextWindow: 1000000,
    // Image input + native web search/fetch (wired in the anthropic seam).
    // Code execution deferred (Anthropic Files API differs).
    capabilities: ["vision", "webSearch"],
  },
};

/** Models the user can't currently select (e.g. over budget), with the reason. */
export type DisabledModels = Partial<Record<ChatModel, { reason: string }>>;

export interface ModelAvailability {
  availableModels: Record<ChatModel, ModelConfig>;
  disabledModels: DisabledModels;
}

/**
 * Fetches both the selectable models and any currently-disabled ones (with a
 * reason, e.g. a budget cap) in a single call. Falls back to all models /
 * nothing-disabled if the API is unreachable.
 */
export async function getModelAvailability(): Promise<ModelAvailability> {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) {
      throw new Error('Failed to fetch model availability');
    }
    const data = await response.json();
    return {
      availableModels: data.availableModels,
      disabledModels: data.disabledModels ?? {},
    };
  } catch (error) {
    logError("Error fetching model availability", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { availableModels: MODEL_CONFIGS, disabledModels: {} };
  }
}

/**
 * Fetches available models from the server API
 * This is necessary because environment variables are only accessible on the server side
 */
export async function getAvailableModels(): Promise<Record<ChatModel, ModelConfig>> {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) {
      throw new Error('Failed to fetch available models');
    }
    const data = await response.json();
    return data.availableModels;
  } catch (error) {
    logError("Error fetching available models", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    // Fallback to all models if API fails
    return MODEL_CONFIGS;
  }
}

/**
 * Fetches available model IDs from the server API
 */
export async function getAvailableModelIds(): Promise<ChatModel[]> {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) {
      throw new Error('Failed to fetch available models');
    }
    const data = await response.json();
    return data.availableModelIds;
  } catch (error) {
    logError("Error fetching available model IDs", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    // Fallback to all model IDs if API fails
    return Object.keys(MODEL_CONFIGS) as ChatModel[];
  }
}

/**
 * Fetches the default model from the server API
 */
export async function getDefaultModel(): Promise<ChatModel> {
  try {
    const response = await fetch('/api/models');
    if (!response.ok) {
      throw new Error('Failed to fetch default model');
    }
    const data = await response.json();
    return data.defaultModel;
  } catch (error) {
    logError("Error fetching default model", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return DEFAULT_MODEL;
  }
}

/**
 * Checks if a specific model is available by fetching from server API
 */
export async function isModelAvailable(modelId: ChatModel): Promise<boolean> {
  try {
    const availableModels = await getAvailableModels();
    return !!availableModels[modelId];
  } catch (error) {
    logError("Error checking model availability", { 
      modelId,
      error: error instanceof Error ? error.message : String(error) 
    });
    // Fallback to checking if model exists in config
    return !!MODEL_CONFIGS[modelId];
  }
}

export interface ChatMessageModel {
  id: string;
  createdAt: Date;
  isDeleted: boolean;
  threadId: string;
  userId: string;
  content: string;
  role: ChatRole;
  name: string;
  multiModalImage?: string;
  multiModalImages?: string[];
  reasoningContent?: string;
  /**
   * Wall-clock the model spent reasoning this turn, in milliseconds. Measured
   * server-side in the /api/chat onChunk timer and round-tripped via the
   * message-adapter so the UI's "Thought for Ns" label survives a reload.
   */
  reasoningDurationMs?: number;
  toolCallHistory?: Array<{ name: string; arguments: string; result?: string; timestamp: Date }>;
  type: typeof MESSAGE_ATTRIBUTE;
  reasoningState?: any;
  /**
   * Stable identifier for the conversational turn this row belongs to.
   * One turn = one user submission + the assistant message + any tool
   * rows generated during it. Allows:
   *   - atomic-turn persistence detection (partial turns are findable)
   *   - turn-level cost rollup
   * Optional for backward compatibility with rows written before this
   * field existed; absence means "pre-turnId data".
   */
  turnId?: string;
}

export type ChatRole = "system" | "user" | "assistant" | "function" | "tool" | "reasoning";

export type AttachedFileType = "code-interpreter" | "search-indexed";

export interface AttachedFileModel {
  id: string;
  name: string;
  type: AttachedFileType;
  uploadedAt?: Date;
}

export interface ThreadUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  lastUpdated: string;
  // Most-recent turn's token counts. Persisted so a reloaded thread can show
  // the same "Last input/output" the header showed live, instead of 0.
  // Optional for backward compatibility with rows written before this existed.
  lastInputTokens?: number;
  lastOutputTokens?: number;
  lastCachedTokens?: number;
}

export interface DefaultTools {
  webSearch?: boolean;
  imageGeneration?: boolean;
  companyContent?: boolean;
  codeInterpreter?: boolean;
}

export interface ChatThreadModel {
  id: string;
  name: string;
  createdAt: Date;
  lastMessageAt: Date;
  userId: string;
  useName: string;
  isDeleted: boolean;
  bookmarked: boolean;
  personaMessage: string;
  personaMessageTitle: string;
  extension: string[];
  type: typeof CHAT_THREAD_ATTRIBUTE;
  personaDocumentIds: string[];
  selectedModel?: ChatModel;
  reasoningEffort?: ReasoningEffort;
  isTemporary?: boolean;
  codeInterpreterContainerId?: string;
  codeInterpreterFileIdsSignature?: string;
  attachedFiles?: Array<AttachedFileModel>;
  subAgentIds?: string[];
  usage?: ThreadUsage;
  defaultTools?: DefaultTools;
  /**
   * Conversation intent, classified once at title-creation time and sticky
   * thereafter. Drives intent-based model downgrade (see model-selection.ts /
   * downgrade-config.ts). Absent on threads created before this field existed.
   */
  intent?: ChatIntent;
}

export interface UserPrompt {
  id: string; // thread id
  message: string;
  // Back-compat: single image
  multimodalImage?: string;
  // Preferred: multiple images
  multimodalImages?: string[];
  selectedModel?: ChatModel;
  reasoningEffort?: ReasoningEffort;
  webSearchEnabled?: boolean;
  imageGenerationEnabled?: boolean;
  companyContentEnabled?: boolean;
  codeInterpreterEnabled?: boolean;
  codeInterpreterFileIds?: string[];
  // ISO 8601 datetime from the user's browser, including the local UTC offset
  // (e.g. "2026-05-29T19:40:00.123+02:00"). Forwarded to the built-in `time`
  // tool so the model can answer questions in the user's local time rather
  // than the server's (typically UTC) clock.
  clientDateTime?: string;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Coarse conversation-intent classes used for intent-based model downgrade.
 * "general" is the safe catch-all (never downgraded). Classified once at
 * title time; see chat-api-text.ts ChatApiTitleAndIntent + downgrade-config.ts.
 */
export type ChatIntent =
  | "coding"
  | "translation"
  | "summarization"
  | "data_analysis"
  | "creative"
  | "general";

export interface ChatDocumentModel {
  id: string;
  name: string;
  chatThreadId: string;
  userId: string;
  isDeleted: boolean;
  createdAt: Date;
  type: typeof CHAT_DOCUMENT_ATTRIBUTE;
}

export interface ToolsInterface {
  name: string;
  description: string;
  parameters: any;
}

export type MenuItemsGroupName = "Bookmarked" | "Past 7 days" | "Previous";

export type MenuItemsGroup = {
  groupName: MenuItemsGroupName;
} & ChatThreadModel;

export type ChatCitationModel = {
  id: string;
  content: any;
  userId: string;
  type: typeof CHAT_CITATION_ATTRIBUTE;
};

export type AzureChatCompletionFunctionCall = {
  type: "functionCall";
  response: ChatCompletionMessage.FunctionCall;
};

export type AzureChatCompletionFunctionCallResult = {
  type: "functionCallResult";
  response: string;
};

export type AzureChatCompletionContent = {
  type: "content";
  response: any; // This will be the streaming snapshot from OpenAI
};

export type AzureChatCompletionFinalContent = {
  type: "finalContent";
  response: string;
};

export type AzureChatCompletionError = {
  type: "error";
  response: string;
};

export type AzureChatCompletionAbort = {
  type: "abort";
  response: string;
};

export type AzureChatCompletionReasoning = {
  type: "reasoning";
  response: string;
};

export interface UsageDataResponse {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  threadTotalCostUsd: number;
  threadTotalTokens: number;
  contextWindowSize: number;
  contextUsagePercent: number;
  model: string;
}

export type AzureChatCompletionUsageData = {
  type: "usageData";
  response: UsageDataResponse;
};

export type AzureChatCompletionUsageWarning = {
  type: "usageWarning";
  response: {
    message: string;
    originalModel: string;
    fallbackModel: string;
    limitType: "tokens" | "cost";
    currentUsage: number;
    limit: number;
  };
};

export type AzureChatCompletion =
  | AzureChatCompletionError
  | AzureChatCompletionFunctionCall
  | AzureChatCompletionFunctionCallResult
  | AzureChatCompletionContent
  | AzureChatCompletionFinalContent
  | AzureChatCompletionAbort
  | AzureChatCompletionReasoning
  | AzureChatCompletionUsageData
  | AzureChatCompletionUsageWarning;

// https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read?view=doc-intel-4.0.0&tabs=sample-code#input-requirements-v4
export enum SupportedFileExtensionsDocumentIntellicence {
  JPEG = "JPEG",
  JPG = "JPG",
  PNG = "PNG",
  BMP = "BMP",
  TIFF = "TIFF",
  HEIF = "HEIF",
  DOCX = "DOCX",
  XLSX = "XLSX",
  PPTX = "PPTX",
  HTML = "HTML",
  PDF = "PDF",
}

// https://platform.openai.com/docs/guides/images?api-mode=responses#image-input-requirements
export enum SupportedFileExtensionsInputImages{
  JPEG = "JPEG",
  JPG = "JPG",
  PNG = "PNG",
  WEBP = "WEBP"
}

export enum SupportedFileExtensionsTextFiles {
  TXT = "TXT",
  LOG = "LOG",
  CSV = "CSV",
  MD = "MD",
  RTF = "RTF",
  HTML = "HTML",
  HTM = "HTM",
  CSS = "CSS",
  JS = "JS",
  JSON = "JSON",
  XML = "XML",
  YML = "YML",
  YAML = "YAML",
  PHP = "PHP",
  PY = "PY",
  JAVA = "JAVA",
  C = "C",
  H = "H",
  CPP = "CPP",
  HPP = "HPP",
  TS = "TS",
  SQL = "SQL",
  INI = "INI",
  CONF = "CONF",
  ENV = "ENV",
  TEX = "TEX",
  SH = "SH",
  BAT = "BAT",
  PS1 = "PS1",
  GITIGNORE = "GITIGNORE",
  GRADLE = "GRADLE",
  GROOVY = "GROOVY",
  MAKEFILE = "MAKEFILE",
  MK = "MK",
  PLIST = "PLIST",
  TOML = "TOML",
  RC = "RC",
}
