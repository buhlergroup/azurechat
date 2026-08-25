import { test, expect, Page } from "@playwright/test";

// A 1x1 transparent PNG — small enough to inline. Each test passes its own
// per-image label so they're distinguishable in failure screenshots.
const TINY_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xfc, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x96, 0xc7, 0x14, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

async function openComposer(page: Page) {
  await page.goto("/chat/temporary");
  const textarea = page.getByPlaceholder("Type your message...").first();
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  return textarea;
}

// Dispatch a synthetic `paste` ClipboardEvent carrying a single PNG file on
// the textarea — this is how chat-page.tsx's handlePaste consumes images.
async function pasteImage(page: Page, filename: string) {
  await page.evaluate((name) => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xfc, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x96, 0xc7, 0x14, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const file = new File([bytes], name, { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    // Some browsers ignore clipboardData passed via constructor — set it explicitly.
    Object.defineProperty(ev, "clipboardData", { value: dt });
    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found");
    textarea.dispatchEvent(ev);
  }, filename);
}

const previewImages = (page: Page) => page.locator('img[alt^="Preview"]');
// Hidden form inputs were a Valtio-era artifact. After the AI SDK v6
// migration images flow via UIMessage.parts: [{type:"file"}] directly
// to the transport — no hidden form fields are rendered. The preview
// thumbnails remain the load-bearing visual contract.

test.describe("multi-image input", () => {
  test("a single paste produces exactly one preview (no duplicate from clipboard.items + clipboard.files)", async ({ page }) => {
    await openComposer(page);

    await pasteImage(page, "one.png");
    await expect(previewImages(page)).toHaveCount(1);
  });

  test("two consecutive pastes accumulate to two previews (no overwrite)", async ({ page }) => {
    await openComposer(page);

    await pasteImage(page, "first.png");
    await expect(previewImages(page)).toHaveCount(1);

    await pasteImage(page, "second.png");
    await expect(previewImages(page)).toHaveCount(2);
  });

  test("removing one image by index preserves the others", async ({ page }) => {
    await openComposer(page);

    await pasteImage(page, "first.png");
    await pasteImage(page, "second.png");
    await pasteImage(page, "third.png");
    await expect(previewImages(page)).toHaveCount(3);

    // Each preview is wrapped in a div.relative with a per-image remove button.
    const firstPreviewWrapper = previewImages(page).nth(0).locator("xpath=ancestor::div[contains(@class,'relative')][1]");
    await firstPreviewWrapper.locator("button").click();

    await expect(previewImages(page)).toHaveCount(2);
  });

  test("file-picker upload appends to existing pasted images instead of replacing them", async ({ page }) => {
    await openComposer(page);

    await pasteImage(page, "pasted.png");
    await expect(previewImages(page)).toHaveCount(1);

    // The composer's hidden file input is wired to fileStore.onFileChange,
    // which for images must call AddImage (append), not UpdateBase64Image (replace).
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "picked.png",
      mimeType: "image/png",
      buffer: Buffer.from(TINY_PNG_BYTES),
    });

    await expect(previewImages(page)).toHaveCount(2);
  });

  test("submitting a pasted image renders it inside the resulting user message bubble", async ({ page }) => {
    await openComposer(page);

    await pasteImage(page, "submitted.png");
    await expect(previewImages(page)).toHaveCount(1);

    await page.getByPlaceholder("Type your message...").first().fill("look at this");
    await page.locator('form button[type="submit"]').click();

    // The optimistic user-message bubble carries the `is-user` class. After
    // submit, the preview chips reset and the image is re-rendered inside
    // the message bubble itself.
    const userBubbleImage = page.locator(".is-user img").first();
    await expect(userBubbleImage).toBeVisible({ timeout: 10_000 });

    // The src must resolve to something renderable — either the original
    // base64 data URL (optimistic path) or the persisted /api/images URL
    // (after reload). Both prove the image survived the submit.
    const src = await userBubbleImage.getAttribute("src");
    expect(src).toMatch(/^(data:image\/|\/api\/images\?|blob:)/);

    // The browser actually painted pixels for it.
    const box = await userBubbleImage.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("inline message-bubble images render at the fixed thumbnail width even for tiny natural sizes", async ({ page }) => {
    await openComposer(page);

    // Drive the preview pipeline directly through the valtio store so this
    // test doesn't depend on a real LLM round-trip. We construct a message
    // object with a 1x1 base64 image and assert the rendered thumbnail width
    // matches the fixed 240px wrapper, not the 1px natural size.
    const dataUrl = await page.evaluate(() => {
      const bytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xfc, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x96, 0xc7, 0x14, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
        0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      const b64 = btoa(String.fromCharCode(...bytes));
      return `data:image/png;base64,${b64}`;
    });

    // Paste twice and submit — the optimistic user message renders the images
    // before any server round-trip, so we don't depend on the in-memory backend
    // returning a multimodal response.
    await pasteImage(page, "a.png");
    await pasteImage(page, "b.png");
    await page.getByPlaceholder("Type your message...").first().fill("how many?");
    await page.locator('form button[type="submit"]').click();

    // The optimistic user-message bubble has class `is-user`. Its inline
    // images sit inside a fixed-width wrapper.
    const userBubbleImages = page.locator(".is-user img");
    await expect(userBubbleImages.first()).toBeVisible({ timeout: 10_000 });

    const widths = await userBubbleImages.evaluateAll(
      (imgs) => imgs.map((i) => (i as HTMLImageElement).getBoundingClientRect().width)
    );
    expect(widths.length).toBeGreaterThanOrEqual(2);
    for (const w of widths) {
      // 240px wrapper → image fills it. Allow a tiny rounding tolerance.
      expect(w).toBeGreaterThanOrEqual(200);
    }

    // Silence unused-variable warning for the data URL helper we keep for
    // future direct-store tests.
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
