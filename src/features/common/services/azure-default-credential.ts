import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

let sharedCredential: DefaultAzureCredential | undefined;

export const getAzureDefaultCredential = () => {
  if (!sharedCredential) {
    sharedCredential = new DefaultAzureCredential();
  }

  return sharedCredential;
};

const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";

export const getAzureCognitiveServicesTokenProvider = () =>
  getBearerTokenProvider(getAzureDefaultCredential(), COGNITIVE_SERVICES_SCOPE);

/**
 * Token provider for the Azure AI Foundry data plane
 * (`*.services.ai.azure.com`). Foundry-served partner models (Anthropic
 * Claude via the /anthropic Messages API) require this scope — the
 * cognitive-services scope above is rejected with 401 there.
 */
const AI_FOUNDRY_SCOPE = "https://ai.azure.com/.default";

export const getAzureAiFoundryTokenProvider = () =>
  getBearerTokenProvider(getAzureDefaultCredential(), AI_FOUNDRY_SCOPE);
