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
