import { test, expect } from "@playwright/test";
import { scriptText, newThreadUrl } from "./_helpers/script-fake";

// Web search is a native server-side built-in tool. The model receives
// web-search results internally and emits only TEXT (with embedded
// citation markdown) to the client. There is no `tool-web_search_preview`
// widget in the UI — this spec verifies that invariant.

const SEARCH_ANSWER =
  "According to recent web search results, the capital of France is Paris. [1](https://example.com)";

test.describe("web-search-execution", () => {
  test("web search answer surfaces in assistant bubble with no orphan bubble", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptText(page, SEARCH_ANSWER);

    await page.goto(threadUrl);
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("What is the capital of France?");
    await page.keyboard.press("Enter");

    const assistantBubble = page.locator(".is-assistant");
    await expect(assistantBubble).toHaveCount(1, { timeout: 15_000 });
    await expect(assistantBubble).toContainText("capital of France is Paris");

    // Web search is a native built-in — must NOT render a tool widget.
    await expect(
      page.getByText("tool-web_search_preview", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("tool-web_search", { exact: true }),
    ).toHaveCount(0);
  });
});
