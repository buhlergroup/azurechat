import { test, expect } from "@playwright/test";
import { scriptComplex, newThreadUrl } from "./_helpers/script-fake";

// Two consecutive tool calls in a single assistant turn.
// Sequence: tool1 → tool2 → final text
// Assertions:
//   - Two distinct tool widgets render (one per call, exact count = 1 each)
//   - The final text appears
//   - Exactly one assistant bubble in the DOM

const TOOL_1_NAME = "search_documents";
const TOOL_2_NAME = "call_sub_agent";
// ToolHeader renders the tool name through `formatToolName`
// (components/ai-elements/tool.tsx): the `tool-` discriminant is dropped,
// snake/kebab separators become spaces and the first letter is capitalised.
// Assert the label the user actually sees.
const TOOL_1_LABEL = "Search documents";
const TOOL_2_LABEL = "Call sub agent";
const FINAL_ANSWER =
  "Based on the documents and agent summary: Q3 revenue was 4.2 million.";

test.describe("multi-turn-tool-loop", () => {
  test("two consecutive tool calls render two widgets and one final answer", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptComplex(page, {
      toolCalls: [
        {
          toolName: TOOL_1_NAME,
          args: { query: "revenue Q3", top: 5 },
          result: { documents: [{ id: "doc-1", content: "Revenue was 4.2M" }] },
        },
        {
          toolName: TOOL_2_NAME,
          args: { agent_id: "agent-99", task: "Summarise revenue doc-1" },
          result: { response: "Revenue totalled 4.2M", summary: "Done" },
        },
      ],
      finalText: FINAL_ANSWER,
    });

    await page.goto(threadUrl);
    // During hydration the composer briefly exists twice in the DOM, which
    // trips Playwright strict mode. Same scoping the jank spec already uses.
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("What was Q3 revenue and summarise it?");
    await page.keyboard.press("Enter");

    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // Both tool widgets must be present.
    await expect(
      page.getByText(TOOL_1_LABEL, { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText(TOOL_2_LABEL, { exact: true }),
    ).toHaveCount(1);

    // Exactly one assistant bubble — no ghost from tool-role messages.
    await expect(page.locator(".is-assistant")).toHaveCount(1, {
      timeout: 5_000,
    });
  });
});
