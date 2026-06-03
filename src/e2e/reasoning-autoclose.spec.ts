import { test, expect } from "@playwright/test";
import { scriptReasoning, newThreadUrl } from "./_helpers/script-fake";

// Long enough that the paced reasoning-delta stream (20ms/word) gives the
// client several frames where reasoning is the last streaming part, so the
// Reasoning panel actually opens before the answer arrives.
const REASONING_TEXT =
  "Let me think about this step by step before I answer the question carefully and thoroughly.";
const FINAL_ANSWER = "The answer is 42.";

test.describe("reasoning auto-close", () => {
  test.setTimeout(60_000); // cold-start tail safety; see abort-stream.spec.ts

  test("reasoning panel opens while thinking, then collapses once the answer is complete", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptReasoning(page, REASONING_TEXT, FINAL_ANSWER);

    await page.goto(threadUrl);
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("What is the meaning of life?");
    await page.keyboard.press("Enter");

    const assistantBubble = page.locator(".is-assistant");
    await expect(assistantBubble).toHaveCount(1, { timeout: 10_000 });

    // The Reasoning trigger is a Radix CollapsibleTrigger; aria-expanded is
    // the unambiguous open/closed signal (independent of mount/hidden quirks).
    const reasoningTrigger = assistantBubble.locator(
      'button[aria-expanded][data-state]',
    );

    // While the model is thinking, the panel must be OPEN.
    await expect(reasoningTrigger).toHaveAttribute("aria-expanded", "true", {
      timeout: 10_000,
    });

    // Answer renders — reasoning streaming has ended.
    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // The fix: once reasoning streaming ends, the panel auto-collapses
    // (AUTO_CLOSE_DELAY is 1s; allow margin) so the user sees where reasoning
    // stops and the answer begins.
    await expect(reasoningTrigger).toHaveAttribute("aria-expanded", "false", {
      timeout: 6_000,
    });

    // The trigger itself stays — it collapsed, it didn't vanish — and shows the
    // completed label.
    await expect(
      assistantBubble.getByText(/Thought for \d+|Thought process/),
    ).toBeVisible({ timeout: 5_000 });
  });
});
