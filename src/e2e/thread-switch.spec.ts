import { test, expect } from "@playwright/test";

// Real-user bug class: messages from thread A leak into thread B (chat store
// not re-keyed on thread change). We create two real threads, send different
// content into each, then switch back to A via the sidebar and assert we see
// A's content and NOT B's.
//
// Runs against AZURECHAT_TEST_BACKEND=memory — real /api/chat, fake OpenAI.
test.describe("thread-switch", () => {
  test("switching threads in the sidebar shows that thread's transcript only", async ({ page }) => {
    await page.goto("/chat");

    // Thread A
    const firstNewChat = page.getByRole("button", { name: /new chat/i }).first();
    await expect(firstNewChat).toBeEnabled({ timeout: 10_000 });
    await firstNewChat.click();
    await expect
      .poll(() => page.url(), { timeout: 45_000, intervals: [200, 400, 800, 1000] })
      .toMatch(/\/chat\/[^/]+$/);
    const threadAUrl = page.url();
    const threadAId = threadAUrl.split("/").pop()!;

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill("alpha-marker-from-thread-A");
    await page.keyboard.press("Enter");
    await expect(page.getByText("alpha-marker-from-thread-A")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 15_000 });

    // Thread B — second New Chat. The sidebar is shared layout, so the button
    // is still in the DOM on /chat/<A>. The form action CreateChatAndRedirect
    // is wired through a server action; on slow CI the click can land before
    // hydration completes, so we observe the URL via polling.
    const newChatButton = page.getByRole("button", { name: /new chat/i }).first();
    await expect(newChatButton).toBeEnabled({ timeout: 10_000 });
    await newChatButton.click();
    await expect
      .poll(() => page.url(), { timeout: 45_000, intervals: [200, 400, 800, 1000] })
      .toMatch(new RegExp(`/chat/(?!${threadAId})[^/]+$`));
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill("beta-marker-from-thread-B");
    await page.keyboard.press("Enter");
    await expect(page.getByText("beta-marker-from-thread-B")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 15_000 });

    // Cross-check: B's transcript does NOT contain A's marker.
    await expect(page.getByText("alpha-marker-from-thread-A")).toHaveCount(0);

    // Switch back to A via the sidebar link (chat-menu.tsx renders one anchor
    // per thread with href=/chat/<id>).
    await page.locator(`a[href="/chat/${threadAId}"]`).first().click();
    await page.waitForURL(threadAUrl, { timeout: 15_000 });
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    // A's marker is back, B's marker stays out.
    await expect(page.getByText("alpha-marker-from-thread-A")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("beta-marker-from-thread-B")).toHaveCount(0);
  });
});
