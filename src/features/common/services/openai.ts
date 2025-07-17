import { AzureOpenAI, OpenAI } from "openai";

export const OpenAIInstance = () => {
  const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME}`,
    defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
    defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2023-05-15",
  });
  return openai;
};

// New v1 API instance for Responses API
export const OpenAIV1Instance = () => {
  const openai = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/v1/`,
    defaultQuery: { "api-version": "preview" },
  });
  return openai;
};

export const OpenAIMiniInstance = () => {
  const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_API_MINI_DEPLOYMENT_NAME}`,
    defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
    defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2023-05-15",
  });
  return openai;
};

export const OpenAIEmbeddingInstance = () => {
  if (
    !process.env.AZURE_OPENAI_API_KEY ||
    !process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME ||
    !process.env.AZURE_OPENAI_API_INSTANCE_NAME
  ) {
    throw new Error(
      "Azure OpenAI Embeddings endpoint config is not set, check environment variables."
    );
  }

  const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME}`,
    defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
    defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2023-05-15",
  });
  return openai;
};

// a new instance definition for DALL-E image generation
export const OpenAIDALLEInstance = () => {
  if (
    !process.env.AZURE_OPENAI_DALLE_API_KEY ||
    !process.env.AZURE_OPENAI_DALLE_API_DEPLOYMENT_NAME ||
    !process.env.AZURE_OPENAI_DALLE_API_INSTANCE_NAME
  ) {
    throw new Error(
      "Azure OpenAI DALLE endpoint config is not set, check environment variables."
    );
  }

  const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_DALLE_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_DALLE_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_DALLE_API_DEPLOYMENT_NAME}`,
    defaultQuery: {
      "api-version":
        process.env.AZURE_OPENAI_DALLE_API_VERSION || "2023-12-01-preview",
    },
    apiVersion: process.env.AZURE_OPENAI_DALLE_API_VERSION || "2023-12-01-preview",
    defaultHeaders: {
      "api-key": process.env.AZURE_OPENAI_DALLE_API_KEY,
    },
  });
  return openai;
};

export const OpenAIVisionInstance = () => {
  if (
    !process.env.AZURE_OPENAI_VISION_API_KEY ||
    !process.env.AZURE_OPENAI_VISION_API_DEPLOYMENT_NAME ||
    !process.env.AZURE_OPENAI_VISION_API_INSTANCE_NAME ||
    !process.env.AZURE_OPENAI_VISION_API_VERSION
  ) {
    throw new Error(
      "Azure OpenAI Vision environment config is not set, check environment variables."
    );
  }

  const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_VISION_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_VISION_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_VISION_API_DEPLOYMENT_NAME}`,
    defaultQuery: {
      "api-version": process.env.AZURE_OPENAI_VISION_API_VERSION,
    },
    apiVersion: process.env.AZURE_OPENAI_VISION_API_VERSION,
    defaultHeaders: { "api-key": process.env.AZURE_OPENAI_VISION_API_KEY },
  });
  return openai;
};

export const OpenAIReasoningInstance = () => {
  if (
    !process.env.AZURE_OPENAI_API_KEY ||
    !process.env.AZURE_OPENAI_API_REASONING_DEPLOYMENT_NAME ||
    !process.env.AZURE_OPENAI_API_INSTANCE_NAME
  ) {
    throw new Error(
      "Azure OpenAI Reasoning deployment config is not set, check environment variables."
    );
  }

  const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/deployments/${process.env.AZURE_OPENAI_API_REASONING_DEPLOYMENT_NAME}`,
    defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION },
    defaultHeaders: { "api-key": "2025-04-01-preview" },
    apiVersion: "2025-04-01-preview",
  });
  return openai;
};

// New v1 API instance for Reasoning models using Responses API
export const OpenAIV1ReasoningInstance = () => {
  if (
    !process.env.AZURE_OPENAI_API_KEY ||
    !process.env.AZURE_OPENAI_API_INSTANCE_NAME
  ) {
    throw new Error(
      "Azure OpenAI API config is not set, check environment variables."
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/v1/`,
    defaultQuery: { "api-version": "preview" },
  });
  return openai;
};

// Image generation instance for v1 API
export const OpenAIV1ImageInstance = () => {
  if (
    !process.env.AZURE_OPENAI_API_KEY ||
    !process.env.AZURE_OPENAI_API_INSTANCE_NAME ||
    !process.env.AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME
  ) {
    throw new Error(
      "Azure OpenAI Image generation config is not set, check environment variables."
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME}.openai.azure.com/openai/v1/`,
    defaultQuery: { "api-version": "preview" },
    defaultHeaders: { 
      "x-ms-oai-image-generation-deployment": process.env.AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME 
    },
  });
  return openai;
};
