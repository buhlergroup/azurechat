import { describe, it, expect } from "vitest";
import {
  CHARS_PER_TOKEN,
  CONTEXT_WINDOW_GUARD_RATIO,
  DEFAULT_HISTORY_TOKEN_BUDGET,
  HISTORY_LONG_CONTEXT_RESERVE,
  HISTORY_TRIM_TARGET_RATIO,
  IMAGE_TOKEN_ESTIMATE,
  MIN_KEPT_TURNS,
  applyHistoryWatermark,
  estimateHistoryTokens,
  estimateMessageTokens,
  estimateTextTokens,
  planHistoryTrim,
  resolveHistoryBudget,
  resolveHistoryProtectedTurns,
  resolveHistoryLongContextReserve,
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

describe("chat-page.unit.history-budget.006 — no persisted turn is protected by default", () => {
  it("protects nothing by default, so even the newest persisted turn can go", () => {
    // The current user message is NOT in these rows (the chat path writes it
    // after reading history), so "0 protected" still leaves the question
    // being answered intact. What it stops is a cost cut that spares the
    // expensive turn.
    expect(MIN_KEPT_TURNS).toBe(0);
    expect(resolveHistoryProtectedTurns()).toBe(0);

    const rows: BudgetMessage[] = [...turn(100), ...turn(100), ...turn(15_000)];
    const plan = planHistoryTrim(rows, { budget: 12_000 });

    expect(plan.trimmed).toBe(true);
    // The 15k turn is the newest AND the reason the thread is over budget.
    // Protecting it was the defect: the trimmer dropped the two small turns
    // instead, added a summary, and the prompt grew.
    expect(plan.kept).toEqual([]);
    expect(plan.droppedTurnCount).toBe(3);
    expect(plan.estimatedTokensAfter).toBeLessThan(plan.estimatedTokensBefore);
  });

  it("restores the old shape when HISTORY_PROTECTED_TURNS asks for it", () => {
    expect(resolveHistoryProtectedTurns({ envProtectedTurns: "2" })).toBe(2);
    // Junk, negatives and fractions fall back to the default rather than
    // protecting a strange number of turns.
    for (const envProtectedTurns of ["", "  ", "abc", "-1", "1.5", "NaN"]) {
      expect(resolveHistoryProtectedTurns({ envProtectedTurns })).toBe(0);
    }
    // An explicit zero is honoured, not treated as "unset".
    expect(resolveHistoryProtectedTurns({ envProtectedTurns: "0" })).toBe(0);

    const rows = turns(30, 1_000);
    const lastFourIds = rows.slice(-4).map((m) => m.id); // 2 turns x 2 rows
    const plan = planHistoryTrim(rows, { budget: 2_000, minKeptTurns: 2 });
    expect(plan.kept.map((m) => m.id).slice(-4)).toEqual(lastFourIds);
    expect(plan.dropped.map((m) => m.id)).not.toContain(lastFourIds[0]);
  });

  it("honours an explicit minKeptTurns when they fit under the target", () => {
    // 20 turns x 1,000 tokens = 20,000. Budget 12,000 -> target 7,200, and
    // five protected turns are 5,000, so the cut can reach the target with
    // them intact.
    const rows = turns(20, 1_000);
    const newestFiveTurnIds = rows.slice(-10).map((m) => m.id);
    const plan = planHistoryTrim(rows, { budget: 12_000, minKeptTurns: 5 });

    expect(plan.trimmed).toBe(true);
    expect(splitIntoTurns(plan.kept).length).toBeGreaterThanOrEqual(5);
    // The protected turns are all still there, verbatim.
    expect(plan.kept.map((m) => m.id).slice(-10)).toEqual(newestFiveTurnIds);
    for (const id of newestFiveTurnIds) {
      expect(plan.dropped.map((m) => m.id)).not.toContain(id);
    }
  });
});

describe("chat-page.unit.history-budget.012 — a trim that cannot help is not taken", () => {
  it("declines when the floor a trim cannot remove is already over target", () => {
    // Protected turns + the replacement summary's allowance + the static
    // prefix. If that is over target, the best possible cut still leaves the
    // thread over budget, so trimming would delete context and spend a model
    // call for nothing. This is the guard the "compacted 17k -> 19k" loop
    // needed.
    const rows: BudgetMessage[] = [...turn(100), ...turn(100), ...turn(15_000)];
    const plan = planHistoryTrim(rows, {
      budget: 12_000,
      minKeptTurns: 2,
      summaryReserveTokens: 2_000,
    });

    expect(plan.trimmed).toBe(false);
    expect(plan.dropped).toEqual([]);
    expect(plan.skipReason).toBe("cannot-reach-target");
    expect(plan.targetUnreachable).toBe(true);
    // Nothing was dropped, so the caller must not spend a summariser call.
    expect(plan.droppedTurnCount).toBe(0);
  });

  it("declines when the summary would cost as much as the turns it replaces", () => {
    // The shape from the live defect: the PROVIDER says the last prompt was
    // 5,000 tokens (over the 700 budget, so a trim is triggered), but the
    // history this module can actually drop is only 400 estimated tokens —
    // less than the 400-token summary that would replace it. Dropping both
    // turns would delete context and leave the prompt the same size.
    const rows = turns(2, 200); // 2 turns x 200 tokens = 400 estimated
    const plan = planHistoryTrim(rows, {
      budget: 700, // target 420
      summaryReserveTokens: 400,
      measuredTokensBefore: 5_000,
    });

    expect(plan.trimmed).toBe(false);
    expect(plan.skipReason).toBe("no-reduction");
    expect(plan.dropped).toEqual([]);
  });

  it("never reports a post-trim estimate above the pre-trim one", () => {
    // The invariant the notice claims on screen. Swept across shapes and
    // budgets, including the ones that used to grow the prompt.
    for (const summaryReserveTokens of [0, 500, 1_500, 2_000]) {
      for (const budget of [500, 2_000, 12_000, 80_000]) {
        for (const rows of [
          turns(4, 400),
          turns(30, 1_000),
          [...turn(100), ...turn(100), ...turn(15_000)],
          [...turn(60_000), ...turn(100)],
        ]) {
          const plan = planHistoryTrim(rows, {
            budget,
            summaryReserveTokens,
          });
          if (!plan.trimmed) continue;
          expect(plan.estimatedTokensAfter).toBeLessThan(
            plan.estimatedTokensBefore,
          );
        }
      }
    }
  });
});

describe("chat-page.unit.history-budget.013 — the real prompt size decides whether to trim", () => {
  it("prefers the provider's number over the estimate", () => {
    // 10 turns x 1,000 = 10,000 estimated tokens, i.e. UNDER the 12,000
    // budget. The estimate alone would not trim; the provider's 17,565 does.
    const rows = turns(10, 1_000);
    const plan = planHistoryTrim(rows, {
      budget: 12_000,
      measuredTokensBefore: 17_565,
    });
    // The estimate says "fits"; the provider says the last prompt was 17.5k.
    // The provider wins: what costs money is the real prompt.
    expect(plan.triggerSource).toBe("measured");
    expect(plan.triggerTokens).toBe(17_565);
    expect(plan.trimmed).toBe(true);
  });

  it("falls back to the estimate for a thread with no usage yet", () => {
    const rows = turns(80, 1_000); // 20,000 estimated tokens, over budget
    const plan = planHistoryTrim(rows, { budget: 12_000 });
    expect(plan.triggerSource).toBe("estimated");
    expect(plan.triggerTokens).toBe(plan.estimatedTokensBefore);
    expect(plan.trimmed).toBe(true);
  });

  it("ignores an unusable measured value (negative)", () => {
    const rows = turns(4, 400);
    for (const measuredTokensBefore of [0, -1, Number.NaN]) {
      const plan = planHistoryTrim(rows, { budget: 12_000, measuredTokensBefore });
      expect(plan.triggerSource).toBe("estimated");
      expect(plan.trimmed).toBe(false);
    }
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
  it("defaults to 256,000 tokens, so summarisation is a late event", () => {
    // Trimming is lossy - the dropped block survives only as a ~1,500-token
    // summary - so it should be paid late. 256k is also exactly where the 5.6
    // guard lands (272k threshold - 16k reserve), so on the default model the
    // configured budget and the model ceiling agree.
    expect(DEFAULT_HISTORY_TOKEN_BUDGET).toBe(256_000);
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

describe("chat-page.unit.history-budget.010 - long-context guard", () => {
  it("reserves 16,000 tokens for the developer message and the current turn", () => {
    expect(HISTORY_LONG_CONTEXT_RESERVE).toBe(16_000);
    expect(resolveHistoryLongContextReserve()).toBe(16_000);
    expect(resolveHistoryLongContextReserve({})).toBe(16_000);
    expect(resolveHistoryLongContextReserve({ envReserve: "32000" })).toBe(32_000);
    // An explicit zero is a choice; junk is not.
    expect(resolveHistoryLongContextReserve({ envReserve: "0" })).toBe(0);
    for (const envReserve of ["", "  ", "abc", "-1", "NaN"]) {
      expect(resolveHistoryLongContextReserve({ envReserve })).toBe(
        HISTORY_LONG_CONTEXT_RESERVE,
      );
    }
  });

  it("keeps a 5.6 thread just under the 272k long-context billing tier", () => {
    // Azure bills 5.6 input above 272k at 2x (the LongCo* meters). 272k minus
    // the 16k reserve is 256k, which is also the configured default, so the
    // two agree and neither is silently doing the other's job.
    const decision = resolveHistoryBudget({
      longContextThresholdTokens: 272_000,
      contextWindow: 1_050_000,
    });
    expect(decision.budget).toBe(256_000);
    expect(decision.guard).toBe(256_000);
    expect(decision.guardSource).toBe("longContextThreshold");
    expect(decision.baseSource).toBe("default");
    expect(decision.cappedByGuard).toBe(false);
  });

  it("takes 60 % of the context window when the model declares no threshold", () => {
    // No billing cliff to price, just a wall: a 128k window gives 76,800 and
    // leaves 40 % for the developer message, the current turn, tool results
    // and the reply.
    const decision = resolveHistoryBudget({ contextWindow: 128_000 });
    expect(decision.budget).toBe(76_800);
    expect(decision.guard).toBe(76_800);
    expect(decision.guardSource).toBe("contextWindow");
    expect(decision.cappedByGuard).toBe(true);
    expect(CONTEXT_WINDOW_GUARD_RATIO).toBe(0.6);
  });

  it("caps an env budget that is larger than the guard", () => {
    // The env override wins the BASE budget and still loses to the guard: it
    // is a lever for dialling the budget down, not for overrunning a model.
    const capped = resolveHistoryBudget({
      envBudget: "900000",
      longContextThresholdTokens: 272_000,
      contextWindow: 1_050_000,
    });
    expect(capped.baseBudget).toBe(900_000);
    expect(capped.baseSource).toBe("env");
    expect(capped.budget).toBe(256_000);
    expect(capped.cappedByGuard).toBe(true);

    // Same for a small-window model.
    expect(
      resolveHistoryBudget({ envBudget: "500000", contextWindow: 128_000 }).budget,
    ).toBe(76_800);

    // Below the guard the env value stands, untouched.
    const under = resolveHistoryBudget({
      envBudget: "40000",
      longContextThresholdTokens: 272_000,
    });
    expect(under.budget).toBe(40_000);
    expect(under.cappedByGuard).toBe(false);
  });

  it("prefers the threshold over the context window, and honours the reserve", () => {
    const decision = resolveHistoryBudget({
      envBudget: "900000",
      longContextThresholdTokens: 272_000,
      contextWindow: 128_000,
      envReserve: "32000",
    });
    // The priced cliff decides, not the wall.
    expect(decision.guardSource).toBe("longContextThreshold");
    expect(decision.reserve).toBe(32_000);
    expect(decision.budget).toBe(240_000);
  });

  it("stands the configured budget when the model declares neither ceiling", () => {
    const decision = resolveHistoryBudget({ modelBudget: 40_000 });
    expect(decision.budget).toBe(40_000);
    expect(decision.baseSource).toBe("model");
    expect(decision.guard).toBeUndefined();
    expect(decision.guardSource).toBe("none");
    expect(decision.cappedByGuard).toBe(false);
  });

  it("discards a guard that would come out at or below zero (negative)", () => {
    // A reserve bigger than the model's own threshold is a misconfiguration.
    // Applying it would carry NO history on every thread of that model.
    const decision = resolveHistoryBudget({
      longContextThresholdTokens: 8_000,
      envReserve: "16000",
    });
    expect(decision.guard).toBeUndefined();
    expect(decision.guardSource).toBe("none");
    expect(decision.budget).toBe(DEFAULT_HISTORY_TOKEN_BUDGET);
  });

});

describe("chat-page.unit.history-budget.011 - the trim follows the effective budget", () => {
  it("trims to 60 % of the EFFECTIVE budget, not of the configured one", () => {
    // Configured 900k, guarded down to 76,800 by a 128k window: the trim has
    // to land on 60 % of 76,800, otherwise the hysteresis is measured against
    // a budget the model never had.
    const budget = resolveHistoryTokenBudget({
      envBudget: "900000",
      contextWindow: 128_000,
    });
    expect(budget).toBe(76_800);

    const rows = turns(400, 800); // ~80k estimated tokens, over the guard
    const plan = planHistoryTrim(rows, {
      budget,
      targetRatio: resolveHistoryTrimTargetRatio(),
    });
    expect(plan.trimmed).toBe(true);
    expect(plan.budget).toBe(76_800);
    expect(plan.target).toBe(46_080); // 76,800 x 0.6
    expect(estimateHistoryTokens(plan.kept)).toBeLessThanOrEqual(46_080);
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
