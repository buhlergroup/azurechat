import { test, expect } from "@playwright/test";
import { scriptReasoning, newThreadUrl } from "./_helpers/script-fake";

const REASONING_TEXT = "Let me think about this step by step. First I need to consider all factors.";
const FINAL_ANSWER = "The answer is 42.";

test.describe("reasoning-effort", () => {
  test.setTimeout(60_000); // cold-start tail safety; see abort-stream.spec.ts

  test("reasoning event produces reasoning section and content renders", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptReasoning(page, REASONING_TEXT, FINAL_ANSWER);

    await page.goto(threadUrl);
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("What is the meaning of life?");
    await page.keyboard.press("Enter");

    // Final answer must render first — confirms stream fully consumed.
    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // Scope every reasoning assertion to inside the assistant bubble.
    // "Reasoning" also appears in the ReasoningEffortSelector UI; scoping
    // eliminates that false positive.
    const assistantBubble = page.locator(".is-assistant");
    await expect(assistantBubble).toHaveCount(1, { timeout: 5_000 });

    // The Reasoning component renders ONLY when reasoning text is present
    // on the assistant UIMessage. The trigger label inside the bubble
    // proves reasoning was routed to the reasoning part, not text.
    await expect(
      assistantBubble.getByText(/Thinking\.\.\.|Thought for \d+|^Reasoning$/),
    ).toBeVisible({ timeout: 5_000 });

    // And the reasoning text itself must appear inside the assistant bubble.
    await expect(assistantBubble).toContainText(REASONING_TEXT);
  });
});
