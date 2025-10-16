import { SecretClient } from "@azure/keyvault-secrets";
import { getAzureDefaultCredential } from "./azure-default-credential";

export const AzureKeyVaultInstance = () => {
  const credential = getAzureDefaultCredential();
  const keyVaultName = process.env.AZURE_KEY_VAULT_NAME;

  if (!keyVaultName) {
    throw new Error(
      "Azure Key vault is not configured correctly, check environment variables."
    );
  }
  const url = `https://${keyVaultName}.vault.azure.net`;

  return new SecretClient(url, credential);
};
