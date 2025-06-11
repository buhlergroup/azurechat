import { ChatCompletionMessage } from "openai/resources/chat/completions";
import { OpenAIInstance, OpenAIReasoningInstance } from "@/features/common/services/openai";

export const CHAT_DOCUMENT_ATTRIBUTE = "CHAT_DOCUMENT";
export const CHAT_THREAD_ATTRIBUTE = "CHAT_THREAD";
export const MESSAGE_ATTRIBUTE = "CHAT_MESSAGE";
export const CHAT_CITATION_ATTRIBUTE = "CHAT_CITATION";

export type ChatModel = "gpt-4.1" | "o3" | "o4-mini";

export interface ModelConfig {
  id: ChatModel;
  name: string;
  description: string;
  getInstance: () => any;
  supportsReasoning: boolean;
  supportedSummarizers?: string[];
}

export const MODEL_CONFIGS: Record<ChatModel, ModelConfig> = {
  "gpt-4.1": {
    id: "gpt-4.1",
    name: "GPT-4.1",
    description: "Fast responses, general conversations",
    getInstance: () => OpenAIInstance(),
    supportsReasoning: false
  },
  "o3": {
    id: "o3",
    name: "o3 reasoning",
    description: "Latest reasoning model, step-by-step thinking",
    getInstance: () => OpenAIReasoningInstance(),
    supportsReasoning: true,
    supportedSummarizers: ["detailed", "concise"]
  },
  "o4-mini": {
    id: "o4-mini",
    name: "o4-Mini",
    description: "Latest mini reasoning model with detailed summaries",
    getInstance: () => OpenAIReasoningInstance(),
    supportsReasoning: true,
    supportedSummarizers: ["detailed"]
  }
};

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
  reasoningContent?: string;
  type: typeof MESSAGE_ATTRIBUTE;
}

export type ChatRole = "system" | "user" | "assistant" | "function" | "tool";

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
}

export interface UserPrompt {
  id: string; // thread id
  message: string;
  multimodalImage: string;
  selectedModel?: ChatModel;
  reasoningEffort?: ReasoningEffort;
}

export type ReasoningEffort = "low" | "medium" | "high";

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

export type AzureChatCompletion =
  | AzureChatCompletionError
  | AzureChatCompletionFunctionCall
  | AzureChatCompletionFunctionCallResult
  | AzureChatCompletionContent
  | AzureChatCompletionFinalContent
  | AzureChatCompletionAbort
  | AzureChatCompletionReasoning;

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
