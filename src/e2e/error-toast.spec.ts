import { test, expect } from "@playwright/test";
import { scriptError } from "./_helpers/script-fake";

test.describe("error-toast", () => {
  test("an LLM error surfaces a visible error region after sending a message", async ({ page }) => {
    await scriptError(page, "Simulated upstream failure");

    await page.goto("/chat/temporary");

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("trigger an error");
    await page.keyboard.press("Enter");

    // chat-page.tsx renders chat.error inline (architect2 SEV-1 B6).
    // Either that destructive banner, the legacy Radix toast, or any role
    // status/alert node must appear.
    const errorRegion = page
      .locator(
        '[data-variant="destructive"], [role="status"], [role="alert"], .bg-destructive\\/10',
      )
      .filter({ hasText: /./ })
      .first();
    await expect(errorRegion).toBeVisible({ timeout: 15_000 });
  });
});
