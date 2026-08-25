import { test, expect } from "@playwright/test";
import { scriptComplex, newThreadUrl } from "./_helpers/script-fake";

// Verifies a single streamed assistant message containing reasoning + a tool
// call + final text all renders correctly with no duplicate widgets and no
// orphan bubble.

const REASONING_TEXT = "I should look up the weather first before answering.";
const TOOL_NAME = "get_weather";
// ToolHeader renders the tool name through `formatToolName`
// (components/ai-elements/tool.tsx): the `tool-` discriminant is dropped,
// snake/kebab separators become spaces and the first letter is capitalised.
// Assert the label the user actually sees.
const TOOL_LABEL = "Get weather";
const FINAL_ANSWER =
  "Based on my reasoning and the weather tool: it is 18 degrees Celsius and partly cloudy in Zurich.";

test.describe("persistence-round-trip", () => {
  test("complex message (reasoning + tool call + text) all render in one stream", async ({
    page,
  }) => {
    const threadUrl = await newThreadUrl(page);
    await scriptComplex(page, {
      reasoning: REASONING_TEXT,
      toolCalls: [
        {
          toolName: TOOL_NAME,
          args: { city: "Zurich" },
          result: { temperature: "18", condition: "partly cloudy" },
        },
      ],
      finalText: FINAL_ANSWER,
    });

    await page.goto(threadUrl);
    // During hydration the composer briefly exists twice in the DOM, which
    // trips Playwright strict mode. Same scoping the jank spec already uses.
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("What is the weather in Zurich?");
    await page.keyboard.press("Enter");

    // Final answer must render — stream fully consumed.
    await expect(page.getByText(FINAL_ANSWER)).toBeVisible({ timeout: 15_000 });

    // Tool widget renders exactly once.
    await expect(
      page.getByText(TOOL_LABEL, { exact: true }),
    ).toHaveCount(1);

    // Reasoning section trigger renders.
    await expect(
      page.getByText(/Thinking\.\.\.|Thought for \d+|Reasoning/, { exact: false }),
    ).toBeVisible({ timeout: 5_000 });

    // Reasoning text is in the DOM (CollapsibleContent, may be collapsed).
    await expect(
      page.getByText(REASONING_TEXT, { exact: false }),
    ).toBeAttached({ timeout: 5_000 });

    // Exactly one assistant bubble.
    await expect(page.locator(".is-assistant")).toHaveCount(1, {
      timeout: 5_000,
    });
  });
});
