import { test, expect } from "@playwright/test";
import { scriptText } from "./_helpers/script-fake";

// Code Interpreter file rewriting happens server-side; this spec only
// verifies that the rendered markdown image URL produces an <img> in the
// DOM (the renderer side of the pipeline). The sandbox:// rewriter is
// covered by `features/chat-page/chat-services/chat-api/sandbox-rewrite-core.test.ts`.

const IMAGE_URL = "/api/images?threadId=t1&filename=code_interpreter_abc.png";
const IMAGE_MARKDOWN = `Here is your chart:\n\n![output.png](${IMAGE_URL})\n\nAnalysis complete.`;

test.describe("code-interpreter-end-to-end", () => {
  test("assistant message with code-interpreter image URL renders img tag", async ({
    page,
  }) => {
    await scriptText(page, IMAGE_MARKDOWN);

    await page.goto("/chat/temporary");
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("Plot a bar chart of my data");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Analysis complete.")).toBeVisible({
      timeout: 15_000,
    });

    const assistantBubble = page.locator(".is-assistant").first();
    await expect(assistantBubble).toBeVisible({ timeout: 5_000 });

    const img = assistantBubble.locator('img[src*="/api/images"]');
    await expect(img).toBeVisible({ timeout: 5_000 });
  });
});
