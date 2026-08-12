import { test, expect } from "@playwright/test";
import { newThreadUrl } from "./_helpers/script-fake";

// Real-user invariant: attaching a file to the composer surfaces an
// "attached file" chip with the filename + a remove button. The earlier
// "citation chip renders" idea targeted a Markdoc-based renderer that the
// chat page no longer uses (replaced by Streamdown in ai-elements/response),
// so citation rendering isn't reachable from /api/chat mocks.
//
// /api/code-interpreter/upload returns a fake id from the memory backend
// (e2e-fakes/openai.ts → files.create), so this exercises the real upload
// path end-to-end up to the chip render.
test.describe("file-attach-chip", () => {
  test("attaching a file via the hidden composer input renders a file chip with the filename", async ({ page }) => {
    await page.goto(await newThreadUrl(page));
    const textarea = page.getByPlaceholder("Type your message...");
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    // CSV is in CODE_INTERPRETER_ONLY_EXTENSIONS (file-store.ts), so the file
    // routes to /api/code-interpreter/upload (memory backend's fake openai
    // returns id "file-fake-1"). TXT/PDF would go to Azure Search which is
    // unmocked and would 500.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "e2e-report.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("col1,col2\n1,2\n3,4\n"),
    });

    // The chip renders with the filename text.
    await expect(page.getByText("e2e-report.csv").first()).toBeVisible({ timeout: 15_000 });
  });

  test("accepts 20 Code Interpreter files and rejects the 21st", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(await newThreadUrl(page));

    const textarea = page.getByPlaceholder("Type your message...");
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    const fileInput = page.locator('input[type="file"]').first();

    for (let index = 1; index <= 20; index++) {
      const name = `e2e-file-${index}.csv`;
      await fileInput.setInputFiles({
        name,
        mimeType: "text/csv",
        buffer: Buffer.from(`column\n${index}\n`),
      });
      await expect(page.getByText(name, { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }

    await fileInput.setInputFiles({
      name: "e2e-file-21.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("column\n21\n"),
    });

    await expect(
      page.getByText(/Code Interpreter supports a maximum of 20 files/i)
    ).toBeVisible();
    await expect(
      page.getByText("e2e-file-21.csv", { exact: true })
    ).toHaveCount(0);
  });
});
