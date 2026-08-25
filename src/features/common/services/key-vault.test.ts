import { describe, it, expect, vi } from "vitest";

const { mockSecretClientConstructor } = vi.hoisted(() => {
  const mockSecretClientConstructor = vi.fn().mockImplementation(function () {
    return {};
  });
  return { mockSecretClientConstructor };
});

vi.mock("@azure/keyvault-secrets", () => ({
  SecretClient: mockSecretClientConstructor,
}));

vi.mock("@/features/common/services/azure-default-credential", () => ({
  getAzureDefaultCredential: vi.fn(() => ({})),
}));

describe("common.unit.kv — AzureKeyVaultInstance", () => {
  it("common.unit.kv.001: constructs SecretClient with correct vault URL", async () => {
    // AZURE_KEY_VAULT_NAME = "test-kv" from setup.ts
    const { AzureKeyVaultInstance } = await import("./key-vault");
    AzureKeyVaultInstance();
    expect(mockSecretClientConstructor).toHaveBeenCalledWith(
      expect.stringContaining("test-kv"),
      expect.anything()
    );
    const [url] = mockSecretClientConstructor.mock.calls[0];
    expect(url).toBe("https://test-kv.vault.azure.net");
  });

  it("common.unit.kv.002: throws when AZURE_KEY_VAULT_NAME is not set", async () => {
    vi.resetModules();
    vi.stubEnv("AZURE_KEY_VAULT_NAME", "");
    const { AzureKeyVaultInstance } = await import("./key-vault");
    expect(() => AzureKeyVaultInstance()).toThrow(
      "Azure Key vault is not configured correctly"
    );
    vi.stubEnv("AZURE_KEY_VAULT_NAME", "test-kv");
  });
});
