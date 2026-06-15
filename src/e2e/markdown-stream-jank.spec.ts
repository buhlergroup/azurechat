/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { scriptText, newThreadUrl } from "./_helpers/script-fake";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Markdown-streaming jank testbed.
 *
 * Streams real markdown fixtures through the REAL chat UI (fake provider →
 * useChat → RichResponse → CodeBlock) and measures main-thread responsiveness
 * DURING the stream:
 *   - longTasks / maxTask  : Long Tasks API (tasks >50ms blocking the UI)
 *   - tbt                  : total blocking time (Σ max(0, dur-50))
 *   - maxDrift             : worst lateness of a 100ms timer = "the page is
 *                            frozen and can't run anything" proxy
 *
 * Repro hypothesis: code-heavy fixtures pin the main thread because CodeBlock
 * (components/ai-elements/code-block.tsx) renders TWO synchronous Prism
 * highlighters (light+dark) and is unmemoized, so RichResponse re-highlighting
 * the whole growing block on every ~60ms chunk saturates the main thread.
 * `prose` / `large-table` are the smooth controls.
 *
 * Run: E2E_PORT=3000 npx playwright test markdown-stream-jank
 */

type Jank = { longTasks: number; maxTask: number; tbt: number; maxDrift: number; ticks: number };

// Runs in the browser before any app script. Arms a longtask observer and a
// 100ms timer-drift meter; __jankReset() zeroes counters right before we send.
function installJankMeter() {
  const j = { longTasks: 0, maxTask: 0, tbt: 0, maxDrift: 0, ticks: 0 };
  (window as any).__jank = j;
  (window as any).__jankReset = () => {
    j.longTasks = 0; j.maxTask = 0; j.tbt = 0; j.maxDrift = 0; j.ticks = 0;
  };
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        j.longTasks++;
        if (e.duration > j.maxTask) j.maxTask = e.duration;
        j.tbt += Math.max(0, e.duration - 50);
      }
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch {
    /* Long Tasks API unavailable — drift meter still works */
  }
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const drift = now - last - 100;
    if (drift > j.maxDrift) j.maxDrift = drift;
    j.ticks++;
    last = now;
  }, 100);
}

// Smooth controls first, worst case last.
const FIXTURES = ["prose", "large-table", "mixed", "many-code-blocks", "big-code-block"] as const;

// Responsiveness budget for the streaming window. Current code blows past this
// for code-heavy fixtures (the reproduction); the fix should bring all under.
const MAX_LONGTASK_MS = 250;
const MAX_DRIFT_MS = 600;

test.describe("markdown-stream jank", () => {
  for (const name of FIXTURES) {
    test(`stream ${name} stays responsive`, async ({ page }) => {
      test.setTimeout(150_000);
      const md = readFileSync(
        path.resolve(__dirname, "fixtures/markdown", `${name}.md`),
        "utf8",
      );

      await page.addInitScript(installJankMeter);
      const url = await newThreadUrl(page);
      await page.goto(url);

      // Layout renders a desktop + mobile composer; both carry the same
      // placeholder, so scope to the first to avoid strict-mode violations.
      const textarea = page.getByPlaceholder("Type your message...").first();
      await expect(textarea).toBeVisible({ timeout: 30_000 });
      await textarea.fill(`render ${name}`);

      await scriptText(page, md);
      await page.evaluate(() => (window as any).__jankReset());
      await page.keyboard.press("Enter");

      // Wait for the stream to finish (sentinel ends every fixture). A severe
      // freeze can prevent completion within the window — captured as a signal.
      let completed = true;
      try {
        // CodeBlock duplicates code text in light+dark DOM copies, so scope
        // to the first match (the end sentinel is plain text, but be safe).
        await expect(page.getByText("STREAM_DONE_MARKER").first()).toBeVisible({ timeout: 120_000 });
      } catch {
        completed = false;
      }

      const jank = (await page.evaluate(() => (window as any).__jank)) as Jank;
      // eslint-disable-next-line no-console
      console.log(
        `\n[jank] ${name.padEnd(18)} completed=${completed} ` +
          `longTasks=${jank.longTasks} maxTask=${jank.maxTask.toFixed(0)}ms ` +
          `TBT=${jank.tbt.toFixed(0)}ms maxDrift=${jank.maxDrift.toFixed(0)}ms`,
      );

      expect.soft(completed, `${name} stream completed`).toBe(true);
      expect.soft(jank.maxTask, `${name} max long task (ms)`).toBeLessThan(MAX_LONGTASK_MS);
      expect.soft(jank.maxDrift, `${name} worst timer drift (ms)`).toBeLessThan(MAX_DRIFT_MS);
    });
  }

  // The reported freeze: a FOLLOWUP question (prior messages already on screen,
  // no code blocks) froze after ~3 lines as a "1." ordered list started. This
  // reproduces that — a tall prior answer, then a short heading+sentence+list
  // followup — and watches for the StickToBottom auto-scroll "Maximum update
  // depth" render storm (frozen page, generation stalls) plus jank.
  test("followup (prior answer + streaming list) stays responsive", async ({ page }) => {
    test.setTimeout(180_000);
    // PRIOR turn is CODE-HEAVY (a real-world thread whose earlier answers held
    // many code blocks). The followup itself is just heading+sentence+list
    // (no code). The freeze is the message list re-rendering EVERY prior
    // message each chunk → all prior code blocks re-highlight from chunk 1,
    // freezing on the first rendered line before the new answer's own blocks
    // appear. The streaming-defer fix does NOT help here (it only defers the
    // streaming message).
    const prior = readFileSync(path.resolve(__dirname, "fixtures/markdown", "elaborate-many-blocks.md"), "utf8");
    const followup = readFileSync(path.resolve(__dirname, "fixtures/markdown", "followup-short.md"), "utf8");

    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    await page.addInitScript(installJankMeter);
    const url = await newThreadUrl(page);
    await page.goto(url);
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    // Turn 1: a tall CODE-HEAVY prior answer (~20 blocks) — stays on screen.
    await textarea.fill("first question");
    await scriptText(page, prior);
    await page.keyboard.press("Enter");
    await expect(page.getByText("ELAB_DONE_MARKER").first()).toBeVisible({ timeout: 120_000 });

    // Turn 2: the followup — measure jank + console storms DURING this stream.
    await textarea.fill("a follow up question");
    await scriptText(page, followup);
    await page.evaluate(() => (window as any).__jankReset());
    await page.keyboard.press("Enter");

    let completed = true;
    try {
      await expect(page.getByText("FOLLOWUP_DONE_MARKER").first()).toBeVisible({ timeout: 90_000 });
    } catch {
      completed = false;
    }

    const jank = (await page.evaluate(() => (window as any).__jank)) as Jank;
    const updateDepthErrors = consoleErrors.filter((e) => /Maximum update depth/i.test(e)).length;
    // eslint-disable-next-line no-console
    console.log(
      `\n[jank] followup           completed=${completed} ` +
        `longTasks=${jank.longTasks} maxTask=${jank.maxTask.toFixed(0)}ms ` +
        `TBT=${jank.tbt.toFixed(0)}ms maxDrift=${jank.maxDrift.toFixed(0)}ms ` +
        `maxUpdateDepthErrors=${updateDepthErrors} consoleErrors=${consoleErrors.length}`,
    );
    if (consoleErrors.length) {
      // eslint-disable-next-line no-console
      console.log("  console errors (first 3):", consoleErrors.slice(0, 3).join(" | "));
    }

    expect.soft(completed, "followup stream completed").toBe(true);
    expect.soft(updateDepthErrors, "Maximum update depth errors").toBe(0);
    expect.soft(jank.maxDrift, "followup worst timer drift (ms)").toBeLessThan(MAX_DRIFT_MS);
  });

  // Mirrors a real-world frozen message: a single streamed answer that
  // opens with a heading + sentence + ordered list and then contains ~20 code
  // blocks. Measures jank DURING the stream AND ~3.5s PAST completion — the
  // streaming-defer fix swaps Streamdown → the real CodeBlocks all at once when
  // the turn ends, so the completion commit is the remaining risk for many
  // blocks.
  test("elaborate (heading+list then ~20 code blocks) stays responsive incl. completion", async ({ page }) => {
    test.setTimeout(150_000);
    const md = readFileSync(
      path.resolve(__dirname, "fixtures/markdown", "elaborate-many-blocks.md"),
      "utf8",
    );

    await page.addInitScript(installJankMeter);
    const url = await newThreadUrl(page);
    await page.goto(url);
    const textarea = page.getByPlaceholder("Type your message...").first();
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill("expand on this");
    await scriptText(page, md);
    await page.evaluate(() => (window as any).__jankReset());
    await page.keyboard.press("Enter");

    let completed = true;
    try {
      await expect(page.getByText("ELAB_DONE_MARKER").first()).toBeVisible({ timeout: 90_000 });
    } catch {
      completed = false;
    }
    // Capture the completion commit (Streamdown → CodeBlocks swap + highlight).
    await page.waitForTimeout(3500);

    const jank = (await page.evaluate(() => (window as any).__jank)) as Jank;
    // eslint-disable-next-line no-console
    console.log(
      `\n[jank] elaborate-20blocks completed=${completed} ` +
        `longTasks=${jank.longTasks} maxTask=${jank.maxTask.toFixed(0)}ms ` +
        `TBT=${jank.tbt.toFixed(0)}ms maxDrift=${jank.maxDrift.toFixed(0)}ms (incl. completion)`,
    );

    expect.soft(completed, "elaborate stream completed").toBe(true);
    expect.soft(jank.maxTask, "elaborate max long task (ms)").toBeLessThan(MAX_LONGTASK_MS);
    expect.soft(jank.maxDrift, "elaborate worst timer drift (ms)").toBeLessThan(MAX_DRIFT_MS);
  });
});
