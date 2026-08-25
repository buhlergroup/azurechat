import { test, expect } from "@playwright/test";

// Real-user invariants:
//  - Renaming a thread sticks across reload.
//  - Deleting a thread removes it from the sidebar and the URL no longer
//    renders that thread's composer/transcript.
//
// chat-menu-item.tsx hangs rename behind `window.prompt` and delete behind
// `window.confirm`. Playwright's `page.on("dialog")` is how we satisfy both.
test.describe("rename-delete-thread", () => {
  test("rename persists across reload and delete removes the thread", async ({ page }) => {
    const renamedTitle = `Renamed ${Date.now()}`;

    // One dialog handler for the whole test, dispatched by type. Rename uses
    // window.prompt; delete uses window.confirm (chat-menu-item.tsx).
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") await dialog.accept(renamedTitle);
      else if (dialog.type() === "confirm") await dialog.accept();
      else await dialog.dismiss();
    });

    await page.goto("/chat");
    const newChatButton = page.getByRole("button", { name: /new chat/i }).first();
    await expect(newChatButton).toBeEnabled({ timeout: 10_000 });
    await newChatButton.click();
    // Poll the URL: the server-action redirect can land just after the click
    // returns and CI cold-start sometimes misses the navigation event.
    await expect
      .poll(() => page.url(), { timeout: 45_000, intervals: [200, 400, 800, 1000] })
      .toMatch(/\/chat\/[^/]+$/);
    const threadUrl = page.url();
    const threadId = threadUrl.split("/").pop()!;

    // Send one message so the thread is real and visible in the sidebar group.
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill("seed message");
    await page.keyboard.press("Enter");
    await expect(page.getByText("seed message")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /stop/i })).toBeHidden({ timeout: 15_000 });

    // Sidebar has exactly one persisted thread (fresh in-memory cosmos per
    // spec run) so the single dropdown trigger is unambiguous. The trigger
    // is a button whose child SVG carries the aria-label.
    const dropdownTrigger = page.locator('[aria-label="Chat Menu Item Dropdown Menu"]').first();
    await expect(page.locator(`a[href="/chat/${threadId}"]`)).toBeVisible({ timeout: 15_000 });
    await dropdownTrigger.click({ force: true });

    await page.getByRole("menuitem", { name: /rename/i }).click();

    // The sidebar revalidates and renders the new name.
    await expect(page.locator(`a[href="/chat/${threadId}"]`).getByText(renamedTitle)).toBeVisible({
      timeout: 10_000,
    });

    // Reload — the new title is still there.
    await page.goto(threadUrl);
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`a[href="/chat/${threadId}"]`).getByText(renamedTitle)).toBeVisible({
      timeout: 10_000,
    });

    // Now delete. Same dropdown trigger, "Delete" menuitem fires window.confirm
    // which is accepted by the test-wide dialog handler at the top.
    await dropdownTrigger.click({ force: true });
    await page.getByRole("menuitem", { name: /delete/i }).click();

    // DeleteChatThreadByID soft-deletes the thread, revalidates the (chat)
    // layout, and redirects to /chat. The sidebar should reflect the deletion
    // immediately — no reload needed.
    await page.waitForURL(/\/chat\/?$/, { timeout: 15_000 });
    await expect(page.locator(`a[href="/chat/${threadId}"]`)).toHaveCount(0, { timeout: 10_000 });

    // Direct navigation to the dead thread URL does not resurrect the transcript.
    await page.goto(threadUrl);
    await expect(page.getByText("seed message")).toHaveCount(0, { timeout: 10_000 });
  });
});
