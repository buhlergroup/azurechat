"use server";
import "server-only";

import OpenAI from "openai";
import { 
  ChatCompletionMessageParam
} from "openai/resources/chat/completions";
import { FindExtensionByID } from "@/features/extensions-page/extension-services/extension-service";
import { ChatThreadModel, MODEL_CONFIGS } from "../models";
import { ChatTokenService } from "@/features/common/services/chat-token-service";
import { reportPromptTokens } from "@/features/common/services/chat-metrics-service";

export interface ResponsesAPIOptions {
  chatThread: ChatThreadModel;
  userMessage: string;
  history: ChatCompletionMessageParam[];
  extensions?: any[];
  signal: AbortSignal;
  openaiInstance?: any;
  reasoningEffort?: string;
  multiModalImage?: string;
  tools?: any[];
  background?: boolean;
  previousResponseId?: string;
  mcpServers?: any[];
}

export const ChatApiResponses = async (props: ResponsesAPIOptions): Promise<AsyncIterable<any>> => {
  const { 
    userMessage, 
    history, 
    signal, 
    chatThread, 
    openaiInstance, 
    reasoningEffort, 
    extensions = [],
    multiModalImage,
    tools = [],
    background = false,
    previousResponseId,
    mcpServers = []
  } = props;

  const modelConfig = MODEL_CONFIGS[chatThread.selectedModel || "gpt-4o"];
  const openAI = openaiInstance || modelConfig.getInstance();
  const systemMessage = await extensionsSystemMessage(chatThread);

  // Build input messages
  const inputMessages = await buildInputMessages({
    chatThread,
    systemMessage,
    history,
    userMessage,
    multiModalImage
  });
  
  // Report token usage
  await reportTokenUsage(inputMessages, chatThread);

  // Convert to the input format expected by the responses API
  const input = convertToResponsesAPIInput(inputMessages);

  // Build request options
  const requestOptions = buildRequestOptions({
    chatThread,
    input,
    reasoningEffort,
    modelConfig,
    tools,
    background,
    previousResponseId,
    mcpServers
  });

  console.log("🚀 Creating responses stream with options:", {
    model: requestOptions.model,
    inputLength: input.length,
    hasReasoning: !!requestOptions.reasoning,
    hasTools: tools.length > 0,
    hasMCP: mcpServers.length > 0,
    background,
    stream: requestOptions.stream
  });

  // Use the new responses API
  const stream = await openAI.responses.create(requestOptions, { signal: signal });
  
  return stream;
};

// Helper function to build input messages
const buildInputMessages = async (props: {
  chatThread: ChatThreadModel;
  systemMessage: string;
  history: ChatCompletionMessageParam[];
  userMessage: string;
  multiModalImage?: string;
}) => {
  const { chatThread, systemMessage, history, userMessage, multiModalImage } = props;
  
  const inputMessages = [
    {
      role: "system" as const,
      content: chatThread.personaMessage + "\n" + systemMessage,
    },
    ...history,
  ];

  // Handle multimodal input
  if (multiModalImage) {
    inputMessages.push({
      role: "user" as const,
      content: [
        { type: "text", text: userMessage },
        { type: "image_url", image_url: { url: multiModalImage } }
      ]
    });
  } else {
    inputMessages.push({
      role: "user" as const,
      content: userMessage,
    });
  }

  return inputMessages;
};

// Helper function to report token usage
const reportTokenUsage = async (inputMessages: any[], chatThread: ChatThreadModel) => {
  const tokenService = new ChatTokenService();
  let promptTokens = tokenService.getTokenCountFromHistory(inputMessages);

  for (const tokens of promptTokens) {
    reportPromptTokens(tokens.tokens, chatThread.selectedModel || "gpt-4o", tokens.role, {
      personaMessageTitle: chatThread.personaMessageTitle, 
      messageCount: inputMessages.length, 
      threadId: chatThread.id
    });
  }
};

// Helper function to convert messages to Responses API input format
const convertToResponsesAPIInput = (inputMessages: any[]) => {
  return inputMessages.map(msg => {
    if (Array.isArray(msg.content)) {
      // Handle multimodal content
      return {
        type: "message" as const,
        role: msg.role,
        content: msg.content.map((item: any) => {
          if (item.type === "text") {
            return { type: "text", text: item.text };
          } else if (item.type === "image_url") {
            return { type: "image_url", image_url: item.image_url.url };
          }
          return item;
        })
      };
    } else {
      // Handle text content
      return {
        type: "message" as const,
        role: msg.role,
        content: msg.content
      };
    }
  });
};

// Helper function to build request options
const buildRequestOptions = (props: {
  chatThread: ChatThreadModel;
  input: any[];
  reasoningEffort?: string;
  modelConfig: any;
  tools: any[];
  background: boolean;
  previousResponseId?: string;
  mcpServers: any[];
}) => {
  const { 
    chatThread, 
    input, 
    reasoningEffort, 
    modelConfig, 
    tools, 
    background, 
    previousResponseId,
    mcpServers 
  } = props;

  const requestOptions: any = {
    model: modelConfig.deploymentName || chatThread.selectedModel || "gpt-4o",
    input: input,
    stream: true,
    store: true, // Enable stateful responses
  };

  // Add previous response ID for chaining
  if (previousResponseId) {
    requestOptions.previous_response_id = previousResponseId;
  }

  // Add background processing
  if (background) {
    requestOptions.background = true;
  }

  // Add reasoning configuration for reasoning models
  if (modelConfig?.supportsReasoning) {
    requestOptions.reasoning = {
      effort: reasoningEffort || "medium",
      summary: "auto" // Auto gives the best available summary (detailed > concise > none)
    };
    
    console.log(`🧠 Configuring reasoning for responses API with ${chatThread.selectedModel}:`, {
      effort: reasoningEffort || "medium",
      summary: "auto",
      supportedSummarizers: modelConfig.supportedSummarizers
    });
  }

  // Add tools (including function calling and image generation)
  if (tools.length > 0) {
    requestOptions.tools = tools;
  }

  // Add image generation tool for image models
  if (modelConfig?.supportsImageGeneration) {
    requestOptions.tools = requestOptions.tools || [];
    requestOptions.tools.push({ type: "image_generation" });
  }

  // Add MCP servers
  if (mcpServers.length > 0) {
    requestOptions.tools = requestOptions.tools || [];
    requestOptions.tools.push(...mcpServers.map(server => ({
      type: "mcp",
      server_label: server.label,
      server_url: server.url,
      require_approval: server.requireApproval || "always",
      headers: server.headers || {}
    })));
  }

  // Add markdown formatting for reasoning models
  if (modelConfig?.supportsReasoning) {
    // Encourage markdown formatting for better code display
    if (requestOptions.input && requestOptions.input.length > 0) {
      const systemMessage = requestOptions.input.find((msg: any) => msg.role === "system");
      if (systemMessage && systemMessage.content) {
        const formattingPrefix = "Formatting re-enabled - please enclose code blocks with appropriate markdown tags.\n\n";
        
        if (typeof systemMessage.content === "string") {
          // Handle string content
          systemMessage.content = formattingPrefix + systemMessage.content;
        } else if (Array.isArray(systemMessage.content) && systemMessage.content[0]) {
          // Handle array content with text objects
          if (typeof systemMessage.content[0] === "object" && systemMessage.content[0].text) {
            systemMessage.content[0].text = formattingPrefix + systemMessage.content[0].text;
          } else if (typeof systemMessage.content[0] === "string") {
            systemMessage.content[0] = formattingPrefix + systemMessage.content[0];
          }
        }
      }
    }
  }

  return requestOptions;
};

const extensionsSystemMessage = async (chatThread: ChatThreadModel) => {
  let message = "";

  for (const e of chatThread.extension) {
    const extension = await FindExtensionByID(e);
    if (extension.status === "OK") {
      message += ` ${extension.response.executionSteps} \n`;
    }
  }

  return message;
};

// Helper functions for advanced features

export const createBackgroundResponse = async (props: ResponsesAPIOptions) => {
  return ChatApiResponses({ ...props, background: true });
};

export const chainResponse = async (props: ResponsesAPIOptions & { previousResponseId: string }) => {
  return ChatApiResponses(props);
};

export const createResponseWithMCP = async (props: ResponsesAPIOptions & { mcpServers: any[] }) => {
  return ChatApiResponses(props);
};

export const createImageGenerationResponse = async (props: ResponsesAPIOptions) => {
  const imageTools = [{ type: "image_generation", partial_images: 2 }];
  return ChatApiResponses({ ...props, tools: imageTools });
};

// Response management functions
export const retrieveResponse = async (responseId: string, openaiInstance?: any) => {
  const openAI = openaiInstance || MODEL_CONFIGS["gpt-4o"].getInstance();
  return await openAI.responses.retrieve(responseId);
};

export const deleteResponse = async (responseId: string, openaiInstance?: any) => {
  const openAI = openaiInstance || MODEL_CONFIGS["gpt-4o"].getInstance();
  return await openAI.responses.delete(responseId);
};

export const cancelResponse = async (responseId: string, openaiInstance?: any) => {
  const openAI = openaiInstance || MODEL_CONFIGS["gpt-4o"].getInstance();
  return await openAI.responses.cancel(responseId);
};

export const listInputItems = async (responseId: string, openaiInstance?: any) => {
  const openAI = openaiInstance || MODEL_CONFIGS["gpt-4o"].getInstance();
  return await openAI.responses.input_items.list(responseId);
};
