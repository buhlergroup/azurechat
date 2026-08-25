import { test, expect } from "@playwright/test";
import { scriptText } from "./_helpers/script-fake";

test.describe("abort-stream", () => {
  // Bump from the default 30s to 60s — cold-start first-route compile on
  // `next start` can push request latency past 30s on macOS arm64 when
  // this spec hits the chat composer before other chat-using specs have
  // warmed the bundle. Pass-on-retry in CI confirms it's a cold-start
  // tail, not a real correctness issue.
  test.setTimeout(60_000);

  test("/chat/temporary streaming response can be stopped via the stop button", async ({ page }) => {
    // Long-ish text so the stop affordance has time to appear and be clicked
    // before the fake provider naturally finishes.
    await scriptText(
      page,
      "Token one token two token three token four token five token six token seven token eight token nine token ten token eleven token twelve",
    );

    await page.goto("/chat/temporary");

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("Stream something");
    await page.keyboard.press("Enter");

    // While the stream is in-flight, the input switches to a stop button.
    const stopButton = page.getByRole("button", { name: /stop/i }).first();
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
    await stopButton.click();

    // After abort, the send affordance comes back. We assert by waiting for the
    // stop button to leave the DOM rather than relying on a fragile content diff.
    await expect(stopButton).toBeHidden({ timeout: 10_000 });
  });
});
