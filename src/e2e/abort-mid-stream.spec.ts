import { test, expect } from "@playwright/test";
import { scriptText } from "./_helpers/script-fake";

// Extends abort-stream.spec.ts with additional coverage:
//   1. The partial streamed content appears in the assistant bubble BEFORE stop.
//   2. After stop, the partial content remains visible (not cleared).
//   3. The stop button disappears.

test.describe("abort-mid-stream", () => {
  test("partial content rendered before abort remains visible after stop", async ({
    page,
  }) => {
    // Long text so the stream is still in-flight when we click stop.
    await scriptText(
      page,
      "Partial chunk more text here and even more tokens to keep the stream open token thirteen fourteen fifteen sixteen seventeen eighteen",
    );

    await page.goto("/chat/temporary");
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("Tell me something");
    await page.keyboard.press("Enter");

    const stopButton = page.getByRole("button", { name: /stop/i }).first();
    await expect(stopButton).toBeVisible({ timeout: 15_000 });

    // The partial content chunks must have already rendered in the assistant bubble.
    await expect(page.getByText("Partial chunk")).toBeVisible({ timeout: 10_000 });

    await stopButton.click();

    // Stop button disappears.
    await expect(stopButton).toBeHidden({ timeout: 10_000 });

    // The partial content must still be visible — abort should not clear it.
    await expect(page.getByText("Partial chunk")).toBeVisible({ timeout: 5_000 });

    // No empty or orphan bubble — still exactly one assistant bubble.
    await expect(page.locator(".is-assistant")).toHaveCount(1, { timeout: 5_000 });
  });
});
