import { test, expect } from "@playwright/test";
import { scriptText } from "./_helpers/script-fake";

/**
 * Migrated from page.route()-mocked custom-SSE format → fake-provider
 * scripting. The new AI SDK v6 useChat consumes the Vercel UI message
 * stream, which the legacy mock can't produce. See e2e/verification.md
 * for the migration rationale.
 */
test.describe("chat-thread", () => {
  test("send a message in /chat/temporary and render the assistant reply", async ({ page }) => {
    await scriptText(page, "Hello from the assistant!");

    await page.goto("/chat/temporary");

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("Hello, can you help me?");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Hello from the")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("assistant!")).toBeVisible();
  });
});
