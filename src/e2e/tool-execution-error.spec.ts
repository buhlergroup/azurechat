import { test, expect } from "@playwright/test";
import { scriptToolCall, newThreadUrl } from "./_helpers/script-fake";

const TOOL_NAME = "search_documents";
// ToolHeader renders the tool name through `formatToolName`
// (components/ai-elements/tool.tsx): the `tool-` discriminant is dropped,
// snake/kebab separators become spaces and the first letter is capitalised.
// Assert the label the user actually sees.
const TOOL_LABEL = "Search documents";
const FINAL_ANSWER = "I was unable to retrieve the documents due to a search error.";

test.describe("tool-execution-error", () => {
  test("tool error result renders in expanded tool widget", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    // The fake provider emits a normal tool-call/result pair; the "error"
    // here is encoded as the tool result body. The UI doesn't differentiate
    // between successful and error tool results — both render as the tool
    // output, and the assistant text references the failure.
    await scriptToolCall(page, {
      toolName: TOOL_NAME,
      args: { query: "test", top: null, skip: null },
      result: {
        error: "Azure Search connection timeout",
        summary: "failed",
      },
      finalText: FINAL_ANSWER,
    });

    await page.goto(threadUrl);
    // During hydration the composer briefly exists twice in the DOM, which
    // trips Playwright strict mode. Same scoping the jank spec already uses.
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("Search for something that fails");
    await page.keyboard.press("Enter");

    // Final answer renders — stream fully consumed.
    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // The tool widget header must exist exactly once.
    await expect(
      page.getByText(TOOL_LABEL, { exact: true }),
    ).toHaveCount(1);

    // Click the tool header to expand the collapsible content.
    const toolHeader = page.getByText(TOOL_LABEL, { exact: true });
    await toolHeader.click();

    // After expanding, the tool result (error JSON string) must be visible.
    await expect(
      page.getByText(/Azure Search connection timeout/, { exact: false }),
    ).toBeVisible({ timeout: 5_000 });

    // Exactly one assistant bubble — no orphan from tool-role messages.
    await expect(page.locator(".is-assistant")).toHaveCount(1, {
      timeout: 5_000,
    });
  });
});
