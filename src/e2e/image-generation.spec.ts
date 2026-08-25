import { test, expect } from "@playwright/test";
import { scriptText } from "./_helpers/script-fake";

// Image generation: the server-side image_generation built-in tool uploads
// the base64 image to blob storage and the model emits final markdown like
// `![Generated Image](<url>)`. We mock the markdown directly here — the
// upload-to-blob path is exercised by code-interpreter-end-to-end.

const IMAGE_BLOB_URL = "/api/images?threadId=t2&filename=gen_xyz.png";
const ANSWER_TEXT = "Here is the image you requested.";
const FULL_MESSAGE = `${ANSWER_TEXT}\n\n![Generated Image](${IMAGE_BLOB_URL})\n\n`;

test.describe("image-generation", () => {
  test("generated image markdown renders <img> with correct src", async ({
    page,
  }) => {
    await scriptText(page, FULL_MESSAGE);

    await page.goto("/chat/temporary");
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("Generate an image of a sunset");
    await page.keyboard.press("Enter");

    await expect(page.getByText(ANSWER_TEXT)).toBeVisible({ timeout: 15_000 });

    const assistantBubble = page.locator(".is-assistant").first();
    await expect(assistantBubble).toBeVisible({ timeout: 5_000 });

    const img = assistantBubble.locator("img").first();
    await expect(img).toBeVisible({ timeout: 5_000 });

    const src = await img.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).toContain("gen_xyz.png");
  });
});
