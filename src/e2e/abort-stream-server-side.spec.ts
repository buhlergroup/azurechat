import { test, expect } from "@playwright/test";
import { scriptText } from "./_helpers/script-fake";

// Asserts that clicking stop persists partial tokens server-side via the
// POST /api/chat/[id]/stop → abortPublisher → streamText abortSignal →
// onAbort/onFinish → Cosmos chain. A hard reload of the thread after stop
// must still show the partial assistant content — if abortSignal wiring is
// broken the cold reload shows only the user message.
test.describe("abort-stream-server-side", () => {
  test("stopping a stream persists partial tokens to Cosmos so they survive a cold reload", async ({
    page,
  }) => {
    // Enough tokens that partial content appears before we click stop.
    await scriptText(
      page,
      "Partial chunk more text here and even more tokens to keep the stream open token thirteen fourteen fifteen sixteen seventeen eighteen",
    );

    await page.goto("/chat");

    const newChatButton = page.getByRole("button", { name: /new chat/i }).first();
    await expect(newChatButton).toBeEnabled({ timeout: 10_000 });
    await newChatButton.click();
    await expect
      .poll(() => page.url(), { timeout: 45_000, intervals: [200, 400, 800, 1000] })
      .toMatch(/\/chat\/[^/]+$/);
    const threadUrl = page.url();

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("stream something for abort test");
    await page.keyboard.press("Enter");

    const stopButton = page.getByRole("button", { name: /stop/i }).first();
    await expect(stopButton).toBeVisible({ timeout: 15_000 });

    // Wait for at least the first partial chunk so we know tokens are in-flight.
    await expect(page.getByText("Partial chunk")).toBeVisible({ timeout: 10_000 });

    await stopButton.click();
    await expect(stopButton).toBeHidden({ timeout: 10_000 });

    // The client stops immediately, but the server's onFinish → Cosmos
    // write is async. Give it a moment to complete before the cold reload.
    await page.waitForTimeout(1_500);

    // Hard reload — wipes all client state. If the partial tokens were not
    // persisted by onAbort/onFinish to Cosmos, the assistant bubble is empty.
    await page.goto(threadUrl);

    // This is the load-bearing assertion: partial content must survive the
    // cold reload, proving the server-side abort path persisted via Cosmos.
    await expect(page.locator(".is-assistant")).toContainText("Partial chunk", {
      timeout: 15_000,
    });
  });
});
