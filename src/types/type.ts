const azureEnvVars = [
  "AZURE_OPENAI_API_INSTANCE_NAME",
  "AZURE_OPENAI_API_DEPLOYMENT_NAME",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME",
  "AZURE_COSMOSDB_URI",
  "AZURE_COSMOSDB_DB_NAME",
  "AZURE_COSMOSDB_CONTAINER_NAME",
  "AZURE_SEARCH_NAME",
  "AZURE_SEARCH_INDEX_NAME",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "AZURE_AD_CLIENT_ID",
  "AZURE_AD_CLIENT_SECRET",
  "AZURE_AD_TENANT_ID",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT",
  "ADMIN_EMAIL_ADDRESS",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_KEY",
  "AZURE_KEY_VAULT_NAME",
  "AZURE_CLIENT_ID",
] as const;

// next-auth already declares these two keys as optional on ProcessEnv.
type RequiredServerEnvKeys = Exclude<
  (typeof azureEnvVars)[number],
  "NEXTAUTH_SECRET" | "NEXTAUTH_URL"
>;

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Record<RequiredServerEnvKeys, string> {}
  }
}

export {};
