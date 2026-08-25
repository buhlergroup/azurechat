import { test, expect } from "@playwright/test";

/**
 * Real-user invariant: I send a message on thread A, immediately navigate
 * away to /chat (the empty home), wait a moment for the server to finish
 * the LLM call in the background and persist to Cosmos, then navigate back
 * to thread A. The assistant reply must be visible WITHOUT a manual reload.
 *
 * Why this matters:
 *   - The route persists from streamText.onFinish so the server completes
 *     even if the client disconnects.
 *   - The route is force-dynamic and the Next.js router cache for dynamic
 *     routes is disabled (staleTimes.dynamic = 0), so returning to /chat/[id]
 *     refetches fresh data instead of serving a stale RSC snapshot.
 *   - The chat-page passes the freshly-server-rendered messages into
 *     ChatStoreProvider, which calls chat.setMessages so useChat's in-memory
 *     state picks them up without a full page refresh.
 *
 * If any of those is broken, the "Generating in background…" pill stays
 * forever and this test fails.
 *
 * Runs against AZURECHAT_TEST_BACKEND=memory — the fake provider replies
 * with the well-known TEST_REPLY string fast enough that persistence is
 * done before we navigate back.
 */
const TEST_REPLY = "TEST: this is a stubbed assistant reply for e2e.";

test.describe("background-completion", () => {
  test("returning to a thread after navigating away mid-turn shows the assistant reply with no manual reload", async ({
    page,
  }) => {
    await page.goto("/chat");

    // Same "New Chat → redirect to /chat/[id]" path as persisted-multi-turn
    const newChatButton = page.getByRole("button", { name: /new chat/i }).first();
    await expect(newChatButton).toBeEnabled({ timeout: 10_000 });
    await newChatButton.click();
    await expect
      .poll(() => page.url(), {
        timeout: 45_000,
        intervals: [200, 400, 800, 1000],
      })
      .toMatch(/\/chat\/[^/]+$/);
    const threadUrl = page.url();

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    // Submit, then navigate away as quickly as possible so the stream is
    // still in-flight when the browser disconnects.
    await textarea.fill("background completion check");
    await page.keyboard.press("Enter");
    await page.goto("/chat");

    // Allow the server to finish its (fake, fast) LLM call + persist to
    // Cosmos. The fake provider's TEST_REPLY arrives in tens of ms; 2 s is
    // generous and keeps the spec stable on slow CI.
    await page.waitForTimeout(2_000);

    // Returning to the thread must render the assistant reply automatically.
    // This is the load-bearing assertion — if router.refresh-driven
    // re-hydration or chat.setMessages-sync is broken, the assistant
    // bubble never appears and the spec times out here.
    await page.goto(threadUrl);

    await expect(page.locator(".is-assistant")).toContainText(TEST_REPLY, {
      timeout: 10_000,
    });

    // And the "Generating in background…" indicator must not be sticky:
    // after the assistant has landed it should be gone.
    await expect(
      page.getByText("Generating in background", { exact: false })
    ).toHaveCount(0);
  });
});
