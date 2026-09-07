import { describe, it, expect } from "vitest";
import {
  CHARS_PER_TOKEN,
  DEFAULT_HISTORY_TOKEN_BUDGET,
  HISTORY_TRIM_TARGET_RATIO,
  IMAGE_TOKEN_ESTIMATE,
  MIN_KEPT_TURNS,
  applyHistoryWatermark,
  estimateHistoryTokens,
  estimateMessageTokens,
  estimateTextTokens,
  planHistoryTrim,
  resolveHistoryTokenBudget,
  resolveHistoryTrimTargetRatio,
  splitIntoTurns,
  type BudgetMessage,
} from "./history-budget";

// These tests pin the two properties that make the token budget an
// improvement on the `TOP 30` row cap it replaced:
//
//   - a trim lands on a turn boundary, so history is never cut mid-turn; and
//   - a trim goes to 60 % of budget in ONE block, so the prompt prefix stays
//     byte-stable for the many turns it takes to climb back to 100 %.
//
// Everything here is a pure function; there is no Cosmos, no model, no clock.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;
function row(
  role: BudgetMessage["role"],
  chars: number,
  extra: Partial<BudgetMessage> = {},
): BudgetMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    role,
    content: "x".repeat(chars),
    ...extra,
  };
}

/** A user + assistant pair costing roughly `tokens` estimated tokens. */
function turn(tokens: number): BudgetMessage[] {
  const chars = Math.floor((tokens * CHARS_PER_TOKEN) / 2);
  return [row("user", chars), row("assistant", chars)];
}

/** `count` turns of `tokens` each, oldest first. */
function turns(count: number, tokens: number): BudgetMessage[] {
  const out: BudgetMessage[] = [];
  for (let i = 0; i < count; i++) out.push(...turn(tokens));
  return out;
}

// ---------------------------------------------------------------------------

describe("chat-page.unit.history-budget.001 — estimateTextTokens / estimateMessageTokens are deterministic", () => {
  it("returns the same number for the same input, every call", () => {
    const message = row("user", 4001, {
      reasoningContent: "y".repeat(400),
      multiModalImages: ["blob://t/a.png", "blob://t/b.png"],
    });
    const first = estimateMessageTokens(message);
    const runs = Array.from({ length: 25 }, () => estimateMessageTokens(message));
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe(first);
  });

  it("uses chars/4 rounded up, so a non-empty string is never free", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens(undefined)).toBe(0);
    expect(estimateTextTokens("a")).toBe(1);
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcde")).toBe(2);
    expect(estimateTextTokens("x".repeat(4000))).toBe(1000);
  });

  it("counts content + reasoning + a flat cost per image", () => {
    const message: BudgetMessage = {
      id: "m",
      role: "assistant",
      content: "x".repeat(400),
      reasoningContent: "y".repeat(80),
      multiModalImages: ["a", "b"],
    };
    expect(estimateMessageTokens(message)).toBe(
      100 + 20 + 2 * IMAGE_TOKEN_ESTIMATE,
    );
  });

  it("charges an image by count, not by URL length", () => {
    // A persisted image is either a short blob:// ref or a huge inline data:
    // URL. Both cost the model about the same, so the estimate must not track
    // the string — otherwise the same picture changes the budget depending on
    // how it happens to be stored.
    const shortRef = estimateMessageTokens({
      id: "a",
      role: "user",
      multiModalImages: ["blob://t/a.png"],
    });
    const dataUrl = estimateMessageTokens({
      id: "b",
      role: "user",
      multiModalImages: [`data:image/png;base64,${"A".repeat(500_000)}`],
    });
    expect(shortRef).toBe(IMAGE_TOKEN_ESTIMATE);
    expect(dataUrl).toBe(IMAGE_TOKEN_ESTIMATE);
  });

  it("counts a tool row's persisted JSON (arguments and result) via its content", () => {
    const args = JSON.stringify({ query: "z".repeat(200) });
    const result = JSON.stringify({ rows: "w".repeat(800) });
    const toolRow: BudgetMessage = {
      id: "t1",
      role: "tool",
      content: JSON.stringify({ name: "search_documents", arguments: args, result }),
    };
    expect(estimateMessageTokens(toolRow)).toBe(
      Math.ceil(toolRow.content!.length / CHARS_PER_TOKEN),
    );
    // Sanity: the tool payload dominates, so it cannot have been ignored.
    expect(estimateMessageTokens(toolRow)).toBeGreaterThan(250);
  });

  it("estimateHistoryTokens is the sum over rows and is order-independent", () => {
    const rows = [row("user", 100), row("assistant", 240), row("tool", 60)];
    const total = estimateHistoryTokens(rows);
    expect(total).toBe(rows.reduce((s, r) => s + estimateMessageTokens(r), 0));
    expect(estimateHistoryTokens([...rows].reverse())).toBe(total);
  });
});

describe("chat-page.unit.history-budget.002 — splitIntoTurns cuts on user rows", () => {
  it("groups a user row with the tool and assistant rows that follow it", () => {
    const rows = [
      row("user", 40),
      row("assistant", 40),
      row("tool", 40),
      row("assistant", 40),
      row("user", 40),
      row("assistant", 40),
    ];
    const result = splitIntoTurns(rows);
    expect(result).toHaveLength(2);
    expect(result[0].messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result[1].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result[0].startIndex).toBe(0);
    expect(result[0].endIndex).toBe(3);
    expect(result[1].startIndex).toBe(4);
  });

  it("puts rows that precede the first user row into a trimmable preamble", () => {
    const rows = [row("system", 40), row("user", 40), row("assistant", 40)];
    const result = splitIntoTurns(rows);
    expect(result).toHaveLength(2);
    expect(result[0].isPreamble).toBe(true);
    expect(result[1].isPreamble).toBe(false);
  });

  it("returns no turns for no rows", () => {
    expect(splitIntoTurns([])).toEqual([]);
  });

  it("carries each turn's estimated tokens", () => {
    const rows = turn(500);
    const [only] = splitIntoTurns(rows);
    expect(only.estimatedTokens).toBe(estimateHistoryTokens(rows));
  });
});

describe("chat-page.unit.history-budget.003 — no trim while under budget", () => {
  it("returns the input untouched and reports trimmed:false", () => {
    const rows = turns(20, 100); // ~2,000 tokens
    const plan = planHistoryTrim(rows, { budget: 10_000 });
    expect(plan.trimmed).toBe(false);
    expect(plan.dropped).toEqual([]);
    expect(plan.kept).toHaveLength(rows.length);
    expect(plan.kept.map((m) => m.id)).toEqual(rows.map((m) => m.id));
    expect(plan.coversThroughMessageId).toBeUndefined();
    expect(plan.targetUnreachable).toBe(false);
  });

  it("does not trim at exactly the budget (the trigger is strictly above)", () => {
    const rows = turns(4, 250); // 4 x 250 = 1,000 tokens exactly
    expect(estimateHistoryTokens(rows)).toBe(1000);
    expect(planHistoryTrim(rows, { budget: 1000 }).trimmed).toBe(false);
    expect(planHistoryTrim(rows, { budget: 999 }).trimmed).toBe(true);
  });

  it("counts an existing summary towards the budget", () => {
    const rows = turns(4, 250); // 1,000 tokens
    expect(planHistoryTrim(rows, { budget: 1200 }).trimmed).toBe(false);
    expect(
      planHistoryTrim(rows, { budget: 1200, existingSummaryTokens: 500 }).trimmed,
    ).toBe(true);
  });

  it("does not trim an empty history", () => {
    const plan = planHistoryTrim([], { budget: 10 });
    expect(plan.trimmed).toBe(false);
    expect(plan.kept).toEqual([]);
  });
});

describe("chat-page.unit.history-budget.004 — one-block trim to the 60% target, on a turn boundary", () => {
  const budget = 10_000;
  const rows = turns(40, 500); // 20,000 tokens, well over budget

  it("drops a single contiguous block from the front", () => {
    const plan = planHistoryTrim(rows, { budget });
    expect(plan.trimmed).toBe(true);
    // dropped ++ kept must reconstruct the input exactly, in order.
    expect([...plan.dropped, ...plan.kept].map((m) => m.id)).toEqual(
      rows.map((m) => m.id),
    );
  });

  it("lands at or under the 60% target", () => {
    const plan = planHistoryTrim(rows, { budget });
    expect(plan.target).toBe(budget * HISTORY_TRIM_TARGET_RATIO);
    expect(plan.estimatedTokensAfter).toBeLessThanOrEqual(plan.target);
    expect(estimateHistoryTokens(plan.kept)).toBeLessThanOrEqual(plan.target);
  });

  it("does not overshoot — it keeps as much as the target allows", () => {
    const plan = planHistoryTrim(rows, { budget });
    // Putting the oldest kept turn back must break the target, otherwise the
    // trim cut deeper than it needed to.
    const oneTurnBack = estimateHistoryTokens(plan.kept) + 500;
    expect(oneTurnBack).toBeGreaterThan(plan.target);
  });

  it("cuts at a turn boundary: the first kept row is a user row", () => {
    const plan = planHistoryTrim(rows, { budget });
    expect(plan.kept[0].role).toBe("user");
    expect(plan.dropped[plan.dropped.length - 1].role).toBe("assistant");
  });

  it("never separates a tool row from the turn that produced it", () => {
    const withTools: BudgetMessage[] = [];
    for (let i = 0; i < 20; i++) {
      withTools.push(row("user", 800), row("tool", 800), row("assistant", 800));
    }
    const plan = planHistoryTrim(withTools, { budget: 4_000 });
    expect(plan.trimmed).toBe(true);
    expect(plan.kept[0].role).toBe("user");
    // Every kept tool row is preceded, within the kept slice, by a user row.
    plan.kept.forEach((message, index) => {
      if (message.role === "tool") expect(index).toBeGreaterThan(0);
    });
  });

  it("reports the newest dropped row as the watermark", () => {
    const plan = planHistoryTrim(rows, { budget });
    expect(plan.coversThroughMessageId).toBe(
      plan.dropped[plan.dropped.length - 1].id,
    );
  });

  it("leaves room for the replacement summary when one is reserved", () => {
    const withReserve = planHistoryTrim(rows, {
      budget,
      summaryReserveTokens: 1_500,
    });
    expect(
      estimateHistoryTokens(withReserve.kept) + 1_500,
    ).toBeLessThanOrEqual(withReserve.target);
  });
});

describe("chat-page.unit.history-budget.005 — hysteresis: a trim is followed by many quiet turns", () => {
  it("does not trim again after a few small turns are added", () => {
    const budget = 10_000;
    const plan = planHistoryTrim(turns(40, 500), { budget });
    expect(plan.trimmed).toBe(true);

    // Simulate the next few turns: the retained rows plus new small turns.
    // (In the real path the retained span comes from the watermark, which is
    // what test .007 covers.)
    let retained = plan.kept;
    for (let i = 0; i < 4; i++) {
      retained = [...retained, ...turn(300)];
      const next = planHistoryTrim(retained, { budget });
      expect(next.trimmed).toBe(false);
      expect(next.kept.map((m) => m.id)).toEqual(retained.map((m) => m.id));
    }
  });

  it("takes many turns to trim again, and the count follows the 40% gap", () => {
    const budget = 10_000;
    const turnTokens = 250;
    let retained = planHistoryTrim(turns(60, turnTokens), { budget }).kept;

    let quietTurns = 0;
    for (let i = 0; i < 500; i++) {
      retained = [...retained, ...turn(turnTokens)];
      if (planHistoryTrim(retained, { budget }).trimmed) break;
      quietTurns++;
    }

    // The gap between the 100% trigger and the 60% target is 4,000 tokens
    // here, i.e. ~16 turns of 250. The old row cap re-cut on EVERY turn.
    expect(quietTurns).toBeGreaterThan(10);
  });
});

describe("chat-page.unit.history-budget.006 — the newest turns are never trimmed", () => {
  it("keeps at least MIN_KEPT_TURNS turns even when they alone blow the budget", () => {
    const rows = turns(6, 50_000); // 300,000 tokens
    const plan = planHistoryTrim(rows, { budget: 1_000 });
    expect(plan.keptTurnCount).toBeGreaterThanOrEqual(MIN_KEPT_TURNS);
    expect(splitIntoTurns(plan.kept).length).toBeGreaterThanOrEqual(MIN_KEPT_TURNS);
  });

  it("keeps the two newest turns' rows verbatim", () => {
    const rows = turns(30, 1_000);
    const lastFourIds = rows.slice(-4).map((m) => m.id); // 2 turns x 2 rows
    const plan = planHistoryTrim(rows, { budget: 2_000 });
    expect(plan.kept.map((m) => m.id).slice(-4)).toEqual(lastFourIds);
    expect(plan.dropped.map((m) => m.id)).not.toContain(lastFourIds[0]);
  });

  it("trims nothing at all when the thread has only the protected turns", () => {
    const rows = turns(MIN_KEPT_TURNS, 90_000);
    const plan = planHistoryTrim(rows, { budget: 1_000 });
    expect(plan.trimmed).toBe(false);
    expect(plan.dropped).toEqual([]);
    // Flagged so the caller can log it: over budget, nothing droppable.
    expect(plan.targetUnreachable).toBe(true);
  });

  it("flags targetUnreachable when the protected turns keep it over target", () => {
    // Turn sizes ramp up, so the newest (protected) turns are the expensive
    // ones and no legal cut can reach the target.
    const rows: BudgetMessage[] = [
      ...turn(100),
      ...turn(100),
      ...turn(50_000),
      ...turn(50_000),
    ];
    const plan = planHistoryTrim(rows, { budget: 10_000 });
    expect(plan.trimmed).toBe(true);
    expect(plan.targetUnreachable).toBe(true);
    expect(splitIntoTurns(plan.kept)).toHaveLength(MIN_KEPT_TURNS);
  });

  it("honours an explicit minKeptTurns", () => {
    const rows = turns(20, 5_000);
    const plan = planHistoryTrim(rows, { budget: 1_000, minKeptTurns: 5 });
    expect(splitIntoTurns(plan.kept)).toHaveLength(5);
  });
});

describe("chat-page.unit.history-budget.007 — applyHistoryWatermark makes a trim stick", () => {
  it("drops everything up to and including the watermark row", () => {
    const rows = turns(6, 100);
    const { retained, alreadyCompacted, watermarkFound } = applyHistoryWatermark(
      rows,
      rows[3].id,
    );
    expect(watermarkFound).toBe(true);
    expect(alreadyCompacted.map((m) => m.id)).toEqual(
      rows.slice(0, 4).map((m) => m.id),
    );
    expect(retained.map((m) => m.id)).toEqual(rows.slice(4).map((m) => m.id));
  });

  it("returns everything when there is no watermark", () => {
    const rows = turns(3, 100);
    const { retained, watermarkFound } = applyHistoryWatermark(rows, undefined);
    expect(watermarkFound).toBe(false);
    expect(retained.map((m) => m.id)).toEqual(rows.map((m) => m.id));
  });

  it("fails open when the watermark row is gone (a rewound thread)", () => {
    const rows = turns(3, 100);
    const { retained, alreadyCompacted, watermarkFound } = applyHistoryWatermark(
      rows,
      "a-row-that-was-deleted",
    );
    expect(watermarkFound).toBe(false);
    expect(alreadyCompacted).toEqual([]);
    expect(retained.map((m) => m.id)).toEqual(rows.map((m) => m.id));
  });

  it("keeps the retained span fixed as the thread grows — the prefix holds", () => {
    // The regression this pins: without the watermark, re-reading the full
    // thread each turn made the budget re-cut one turn further along every
    // turn, i.e. the same sliding window as `TOP 30`.
    const budget = 10_000;
    const initial = turns(40, 500);
    const firstPlan = planHistoryTrim(initial, { budget });
    const watermark = firstPlan.coversThroughMessageId;
    expect(watermark).toBeDefined();

    let fullThread = initial;
    const retainedHeadIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      fullThread = [...fullThread, ...turn(200)];
      const { retained } = applyHistoryWatermark(fullThread, watermark);
      const plan = planHistoryTrim(retained, { budget });
      expect(plan.trimmed).toBe(false);
      retainedHeadIds.push(plan.kept[0].id);
    }
    // Same first row every turn => the prompt prefix did not move.
    expect(new Set(retainedHeadIds).size).toBe(1);
    expect(retainedHeadIds[0]).toBe(firstPlan.kept[0].id);
  });
});

describe("chat-page.unit.history-budget.008 — resolveHistoryTokenBudget precedence", () => {
  it("defaults to a deliberately moderate 80,000 tokens", () => {
    // Not a context limit (the 5.6 family holds ~1M) but a cost limit. Once a
    // cache entry is evicted the next turn rewrites the whole prompt at 1.25x,
    // so the carried history has to stay affordable at the worst case.
    expect(DEFAULT_HISTORY_TOKEN_BUDGET).toBe(80_000);
  });

  it("falls back to the module default", () => {
    expect(resolveHistoryTokenBudget()).toBe(DEFAULT_HISTORY_TOKEN_BUDGET);
    expect(resolveHistoryTokenBudget({})).toBe(DEFAULT_HISTORY_TOKEN_BUDGET);
  });

  it("uses the model config budget when there is no env override", () => {
    expect(resolveHistoryTokenBudget({ modelBudget: 40_000 })).toBe(40_000);
  });

  it("lets the env override win over the model config", () => {
    expect(
      resolveHistoryTokenBudget({ modelBudget: 40_000, envBudget: "25000" }),
    ).toBe(25_000);
  });

  it("ignores an unusable env value instead of honouring it", () => {
    // A typo in an env var must not silently reduce every thread to no
    // history at all, so anything non-numeric or non-positive is discarded.
    for (const envBudget of ["", "  ", "abc", "0", "-5", "NaN"]) {
      expect(resolveHistoryTokenBudget({ modelBudget: 40_000, envBudget })).toBe(
        40_000,
      );
    }
  });

  it("ignores an unusable model budget", () => {
    expect(resolveHistoryTokenBudget({ modelBudget: 0 })).toBe(
      DEFAULT_HISTORY_TOKEN_BUDGET,
    );
    expect(resolveHistoryTokenBudget({ modelBudget: -1 })).toBe(
      DEFAULT_HISTORY_TOKEN_BUDGET,
    );
  });

  it("floors a fractional value so the budget is always a whole number", () => {
    expect(resolveHistoryTokenBudget({ envBudget: "1234.9" })).toBe(1234);
  });
});

describe("chat-page.unit.history-budget.009 — resolveHistoryTrimTargetRatio", () => {
  it("defaults to 0.6, i.e. a trim lands at 60% of budget", () => {
    expect(HISTORY_TRIM_TARGET_RATIO).toBe(0.6);
    expect(resolveHistoryTrimTargetRatio()).toBe(0.6);
    expect(resolveHistoryTrimTargetRatio({})).toBe(0.6);
  });

  it("honours an env override inside the open interval (0, 1)", () => {
    expect(resolveHistoryTrimTargetRatio({ envRatio: "0.5" })).toBe(0.5);
    expect(resolveHistoryTrimTargetRatio({ envRatio: "0.75" })).toBe(0.75);
  });

  it("ignores a ratio that would remove the hysteresis or the history", () => {
    // 1.0 lands the trim exactly on the trigger, so the next turn trims again
    // and the prefix moves every turn — the behaviour being removed. 0 throws
    // away everything droppable for no cache benefit.
    for (const envRatio of ["1", "1.0", "1.5", "0", "-0.2", "abc", "", "NaN"]) {
      expect(resolveHistoryTrimTargetRatio({ envRatio })).toBe(
        HISTORY_TRIM_TARGET_RATIO,
      );
    }
  });

  it("feeds through to the plan's target", () => {
    const rows = turns(40, 500);
    const plan = planHistoryTrim(rows, {
      budget: 10_000,
      targetRatio: resolveHistoryTrimTargetRatio({ envRatio: "0.4" }),
    });
    expect(plan.target).toBe(4_000);
    expect(estimateHistoryTokens(plan.kept)).toBeLessThanOrEqual(4_000);
  });
});
