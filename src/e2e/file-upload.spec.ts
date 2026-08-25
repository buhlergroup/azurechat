import { test, expect } from "@playwright/test";

test.describe("file-upload", () => {
  test("/chat/temporary exposes a file input in the message composer", async ({ page }) => {
    await page.goto("/chat/temporary");

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    // The composer has a hidden <input type="file"> driven by an icon button.
    // Assert it exists; uploading would round-trip through Document Intelligence
    // which the in-memory stub does not implement.
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toHaveCount(1);
  });
});
