import { test, expect } from "@playwright/test";

// Real-user invariant: send a few messages in a fresh thread, navigate away and
// back, and the transcript is still there. Exercises the full New Chat form
// action → /chat/[id] redirect → /api/chat → in-memory Cosmos persistence path,
// with the AZURECHAT_TEST_BACKEND=memory fake OpenAI replying TEST_REPLY.
//
// Memory backend persists within the single Node process, so reloading the
// page (same server) is the right "leaves and comes back" simulation.
test.describe("persisted-multi-turn", () => {
  test("messages survive a hard reload of /chat/[id]", async ({ page }) => {
    await page.goto("/chat");

    // The New Chat button lives inside `<form action={CreateChatAndRedirect}>`
    // (chat-menu-header.tsx). Submitting redirects to /chat/<new-id>.
    const newChatButton = page.getByRole("button", { name: /new chat/i }).first();
    await expect(newChatButton).toBeEnabled({ timeout: 10_000 });
    await newChatButton.click();
    await expect
      .poll(() => page.url(), { timeout: 45_000, intervals: [200, 400, 800, 1000] })
      .toMatch(/\/chat\/[^/]+$/);
    const threadUrl = page.url();

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    const userMessages = ["first question", "second question", "third question"];
    for (const msg of userMessages) {
      await textarea.fill(msg);
      // Focus the textarea so Enter is interpreted as a submit by the form
      // (without an explicit focus, in CI the keyboard event can be lost if
      // a sibling element has implicit focus after a previous turn).
      await textarea.focus();
      await page.keyboard.press("Enter");
      // The user-message bubble appears optimistically. If it doesn't, the
      // submit didn't actually fire — fail fast rather than waiting through
      // the longer downstream timeouts.
      await expect(page.getByText(msg)).toBeVisible({ timeout: 15_000 });
      // Stop button appears while streaming. Wait for it to APPEAR first
      // (proves the stream actually started), then disappear (proves it
      // finished). Without the appear-then-hide bracket, an instant-finish
      // race can let the loop advance before the assistant turn lands.
      const stopButton = page.getByRole("button", { name: /stop/i });
      await expect(stopButton).toBeVisible({ timeout: 15_000 });
      await expect(stopButton).toBeHidden({ timeout: 15_000 });
    }

    // Three user bubbles + N assistant bubbles per turn (the markdoc tree
    // renders the assistant text in multiple DOM nodes — we don't pin the
    // exact factor, just the post-reload equality).
    for (const msg of userMessages) {
      await expect(page.getByText(msg)).toBeVisible();
    }
    // At least 3 assistant bubbles exist before reload (one per turn). The
    // markdoc tree may produce >1 DOM node per bubble, so we don't pin a
    // specific count.
    await expect
      .poll(() => page.getByText(/TEST: this is a stubbed assistant reply/).count(), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(3);

    // Reload the thread directly — same Node process, in-memory Cosmos still
    // holds the messages. The transcript survives.
    await page.goto(threadUrl);
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    for (const msg of userMessages) {
      await expect(page.getByText(msg)).toBeVisible({ timeout: 10_000 });
    }
    await expect
      .poll(() => page.getByText(/TEST: this is a stubbed assistant reply/).count(), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(3);
  });
});
