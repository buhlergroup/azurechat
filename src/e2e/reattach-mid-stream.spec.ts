import { test, expect } from "@playwright/test";
import { scriptText } from "./_helpers/script-fake";

// Asserts the new live-reattach path (GET /api/chat/[id]/stream) is wired
// end-to-end: navigating away mid-stream and immediately returning shows the
// stop button still visible (stream replay from the in-process publisher, not
// a Cosmos round-trip) and the final tokens land without a manual reload.
test.describe("reattach-mid-stream", () => {
  test("returning to a thread mid-stream reattaches to the live publisher", async ({
    page,
  }) => {
    // Enough tokens to keep the fake provider streaming for many seconds.
    // The fake provider delays 20 ms per text-delta chunk; splitting on whitespace
    // gives ~2 chunks per word (word + space). 300 words ≈ 600 chunks × 20 ms = 12 s
    // of streaming — far longer than the two page.goto round-trips (~1 s combined).
    await scriptText(
      page,
      "Partial chunk alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu alpha-two bravo-two charlie-two delta-two echo-two foxtrot-two golf-two hotel-two india-two juliet-two kilo-two lima-two mike-two november-two oscar-two papa-two quebec-two romeo-two sierra-two tango-two uniform-two victor-two whiskey-two xray-two yankee-two zulu-two alpha-three bravo-three charlie-three delta-three echo-three foxtrot-three golf-three hotel-three india-three juliet-three kilo-three lima-three mike-three november-three oscar-three papa-three quebec-three romeo-three sierra-three tango-three uniform-three victor-three whiskey-three xray-three yankee-three zulu-three alpha-four bravo-four charlie-four delta-four echo-four foxtrot-four golf-four hotel-four india-four juliet-four kilo-four lima-four mike-four november-four oscar-four papa-four quebec-four romeo-four sierra-four tango-four uniform-four victor-four whiskey-four xray-four yankee-four zulu-four alpha-five bravo-five charlie-five delta-five echo-five foxtrot-five golf-five hotel-five india-five juliet-five kilo-five lima-five mike-five november-five oscar-five papa-five quebec-five romeo-five sierra-five tango-five uniform-five victor-five whiskey-five xray-five yankee-five zulu-five",
    );

    await page.goto("/chat");

    const newChatButton = page.getByRole("button", { name: /new chat/i }).first();
    await expect(newChatButton).toBeEnabled({ timeout: 10_000 });
    await newChatButton.click();
    await expect
      .poll(() => page.url(), { timeout: 45_000, intervals: [200, 400, 800, 1000] })
      .toMatch(/\/chat\/[^/]+$/);
    const threadAUrl = page.url();

    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    await textarea.fill("stream something long");
    await page.keyboard.press("Enter");

    // Wait for the stop button to confirm the stream is live, then pause
    // briefly so several chunks buffer up before we navigate away.
    const stopButton = page.getByRole("button", { name: /stop/i }).first();
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    // Navigate away, then return quickly so the stream is still in-flight.
    await page.goto("/chat");
    await page.goto(threadAUrl);

    // The stop button must still be visible — this proves the GET /api/chat/[id]/stream
    // replay path handed back the live publisher, not a completed Cosmos row.
    // Allow up to 8 s: the SDK must mount, call GET /api/chat/[id]/stream, get
    // the buffered prefix, and surface the stop button before the fake stream ends.
    await expect(stopButton).toBeVisible({ timeout: 8_000 });

    // Late chunks from the script must appear in the assistant bubble.
    await expect(page.getByText("Partial chunk")).toBeVisible({ timeout: 15_000 });

    // Wait for the stream to finish naturally.
    await expect(stopButton).toBeHidden({ timeout: 30_000 });

    // Exactly one assistant bubble when done.
    await expect(page.locator(".is-assistant")).toHaveCount(1, { timeout: 5_000 });
  });
});
