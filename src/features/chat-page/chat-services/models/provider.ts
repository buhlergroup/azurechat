/**
 * AI SDK provider seam.
 *
 * Resolves a LanguageModelV3 (LanguageModelV2-compatible) from @ai-sdk/azure
 * for a given ChatModel, via the service-container DI registry.
 *
 * The old AzureOpenAI factories in openai.ts / openai.production.ts continue
 * to function in parallel until task-12 cutover removes them.
 */

import { createAzure } from "@ai-sdk/azure";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import {
  register,
  resolve,
  has,
  SERVICE_KEYS,
} from "@/features/common/services/service-container";
import { getAzureCognitiveServicesTokenProvider } from "@/features/common/services/azure-default-credential";
import { MODEL_CONFIGS, type ChatModel } from "../models";

/** The shape stored under SERVICE_KEYS.aiProvider: a function that maps a
 *  deployment name to a LanguageModelV3. `api` selects the Azure surface:
 *  "responses" (default) or "chat" (chat-completions, for models that don't
 *  support the Responses API). Test fakes that ignore the second arg keep
 *  working. */
export type AiProviderFn = (
  deploymentName: string,
  api?: "responses" | "chat",
) => LanguageModelV3;

/**
 * Returns the LanguageModelV3 for the given ChatModel by looking up the
 * deployment name in MODEL_CONFIGS and delegating to the registered aiProvider.
 * Models with supportsResponsesAPI=false get the chat-completions surface.
 */
export function resolveAzureModel(modelId: ChatModel): LanguageModelV3 {
  const config = MODEL_CONFIGS[modelId];
  if (!config) {
    throw new Error(`resolveAzureModel: unknown modelId "${modelId}"`);
  }
  const deploymentName = config.deploymentName;
  if (!deploymentName) {
    throw new Error(
      `resolveAzureModel: no deploymentName configured for model "${modelId}". ` +
        `Check the relevant AZURE_OPENAI_API_*_DEPLOYMENT_NAME env var.`,
    );
  }
  const provider = resolve<AiProviderFn>(SERVICE_KEYS.aiProvider);
  return provider(deploymentName, config.supportsResponsesAPI ? "responses" : "chat");
}

/**
 * Production factory for the aiProvider service.
 *
 * Auth precedence (mirrors openai.production.ts):
 *   1. AZURE_OPENAI_API_KEY present → API-key auth (`api-key` header).
 *   2. Otherwise → Azure AD via DefaultAzureCredential; the token is fetched
 *      per-request through a custom `fetch` wrapper so that the SDK's
 *      `loadApiKey` call is satisfied by a non-empty placeholder while the
 *      real `Authorization: Bearer …` header overrides it at call time.
 *
 * @ai-sdk/azure config used:
 *   createAzure({ resourceName, apiKey?, apiVersion?, fetch? })
 *   provider(deploymentName) → LanguageModelV3
 */
export function createProductionAzureProvider(): AiProviderFn {
  const resourceName = process.env.AZURE_OPENAI_API_INSTANCE_NAME;
  const apiVersion =
    process.env.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const imageDeploymentName =
    process.env.AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME;

  if (!resourceName) {
    throw new Error(
      "createProductionAzureProvider: AZURE_OPENAI_API_INSTANCE_NAME is not set.",
    );
  }

  // Azure's built-in `image_generation` tool needs a deployment hint via
  // this header. Without it the Responses-API stream closes with
  // finishReason="error" and no useful body. Legacy openai.production.ts
  // set this header — the AI SDK migration regressed it.
  // https://ai-sdk.dev/providers/ai-sdk-providers/azure#image-generation
  const imageGenHeader: Record<string, string> | undefined =
    imageDeploymentName
      ? { "x-ms-oai-image-generation-deployment": imageDeploymentName }
      : undefined;

  if (apiKey) {
    // API-key path: straightforward.
    const azure = createAzure({
      resourceName,
      apiKey,
      apiVersion,
      headers: imageGenHeader,
    });
    return (deploymentName, api) =>
      api === "chat" ? azure.chat(deploymentName) : azure(deploymentName);
  }

  // Azure AD path.
  // @ai-sdk/azure v3 does not expose a token-provider parameter; instead we
  // supply a custom `fetch` wrapper that:
  //   1. Obtains a fresh Bearer token via DefaultAzureCredential.
  //   2. Removes the (empty-placeholder) `api-key` header.
  //   3. Injects `Authorization: Bearer <token>`.
  //
  // We pass apiKey=" " (a single space) so that loadApiKey() inside the SDK
  // does not throw "API key is missing" while still letting our fetch
  // wrapper replace authentication at runtime.
  const getToken = getAzureCognitiveServicesTokenProvider();

  const aadFetch: typeof fetch = async (input, init) => {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.delete("api-key");
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const azure = createAzure({
    resourceName,
    apiKey: " ", // placeholder; replaced by aadFetch above
    apiVersion,
    fetch: aadFetch,
    headers: imageGenHeader,
  });

  return (deploymentName, api) =>
    api === "chat" ? azure.chat(deploymentName) : azure(deploymentName);
}

// Register production binding at module init (skipped if already registered,
// e.g. when e2e-fakes/register.ts has injected a test double first).
if (!has(SERVICE_KEYS.aiProvider)) {
  register(SERVICE_KEYS.aiProvider, createProductionAzureProvider);
}
