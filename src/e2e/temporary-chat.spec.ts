import { test, expect } from "@playwright/test";

test.describe("temporary-chat", () => {
  test("/chat/temporary renders the chat input and is not listed as a normal thread in the sidebar", async ({ page }) => {
    await page.goto("/chat/temporary");

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    // The current URL points at /chat/temporary. A normal thread link in the
    // sidebar would be /chat/<thread-id>; the temporary route is excluded from
    // the FindAllChatThreadForCurrentUser query (filters out isTemporary=true).
    const sidebarLink = page.locator('a[href="/chat/temporary"]');
    await expect(sidebarLink).toHaveCount(0);
  });
});
