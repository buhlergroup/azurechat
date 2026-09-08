import { describe, it, expect } from "vitest";
import {
  COMPACTION_DATA_PART_TYPE,
  COMPACTION_PART_ID,
  compactionDonePart,
  compactionMarkerPlacement,
  compactionMarkerText,
  compactionNoticeText,
  compactionRunningPart,
  formatTokenCount,
  isCompactionDataPart,
  threadCompactionMarker,
} from "./compaction-part";

// The wire contract between /api/chat, the transcript and the thread loader.
// Everything here is pure: no stream, no Cosmos, no React.

describe("chat-page.unit.compaction-part.001 — the part shape", () => {
  it("gives both phases the same id, so the second write replaces the first", () => {
    const running = compactionRunningPart({ turnsToTrim: 4, tokensBefore: 300_000 });
    const done = compactionDonePart({
      trimmedTurns: 4,
      tokensBefore: 300_000,
      tokensAfter: 150_000,
      summaryOutcome: "ok",
      durationMs: 900,
    });
    expect(running.type).toBe(COMPACTION_DATA_PART_TYPE);
    expect(running.type).toBe("data-compaction");
    expect(running.id).toBe(COMPACTION_PART_ID);
    expect(done.id).toBe(running.id);
  });

  it("omits the summary fields rather than sending undefined", () => {
    const done = compactionDonePart({
      trimmedTurns: 2,
      tokensBefore: 90_000,
      tokensAfter: 50_000,
      summaryOutcome: "off",
      durationMs: 11,
      coversThroughMessageId: "m9",
    });
    expect(done.data).toEqual({
      status: "done",
      trimmedTurns: 2,
      tokensBefore: 90_000,
      tokensAfter: 50_000,
      summaryOutcome: "off",
      durationMs: 11,
    });
    expect("summaryText" in done.data).toBe(false);
    expect("summaryModel" in done.data).toBe(false);
    // The watermark is for the persisted divider, not for the wire.
    expect("coversThroughMessageId" in done.data).toBe(false);
  });

  it("carries the summary inline when there is one", () => {
    const done = compactionDonePart({
      trimmedTurns: 12,
      tokensBefore: 184_000,
      tokensAfter: 96_000,
      summaryOutcome: "ok",
      summaryModel: "gpt-5.6-terra",
      durationMs: 4210,
      summaryText: "FACTS: metric units.",
    });
    expect(done.data).toMatchObject({
      summaryText: "FACTS: metric units.",
      summaryModel: "gpt-5.6-terra",
    });
  });

  it("narrows only its own part type (negative)", () => {
    expect(isCompactionDataPart({ type: "data-compaction" })).toBe(true);
    for (const type of ["text", "reasoning", "data-usage-warning", ""]) {
      expect(isCompactionDataPart({ type })).toBe(false);
    }
    expect(isCompactionDataPart({})).toBe(false);
  });
});

describe("chat-page.unit.compaction-part.002 — the copy", () => {
  it("rounds tokens to a short label", () => {
    expect(formatTokenCount(184_000)).toBe("184k");
    expect(formatTokenCount(95_600)).toBe("96k");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(0)).toBe("0");
    // A junk value must not put "NaNk" on screen.
    expect(formatTokenCount(Number.NaN)).toBe("0");
    expect(formatTokenCount(-5)).toBe("0");
  });

  it("says what happened, in each state", () => {
    // Each reason code gets its own line. A boolean could not tell "the
    // operator turned it off" from "the summariser 404'd", and the live defect
    // that prompted these codes was invisible for exactly that reason.
    expect(
      compactionNoticeText({ status: "running", turnsToTrim: 3, tokensBefore: 1 }),
    ).toBe("Compacting older messages…");

    const done = {
      status: "done" as const,
      trimmedTurns: 12,
      tokensBefore: 184_000,
      tokensAfter: 96_000,
      durationMs: 1,
    };
    expect(compactionNoticeText({ ...done, summaryOutcome: "ok" })).toBe(
      "Compacted 12 older turns into a summary (184k → 96k tokens)",
    );
    expect(compactionNoticeText({ ...done, summaryOutcome: "off" })).toBe(
      "Trimmed 12 older turns (no summary, feature off)",
    );
    expect(compactionNoticeText({ ...done, summaryOutcome: "failed" })).toBe(
      "Trimmed 12 older turns (summary failed, see server log)",
    );
    expect(compactionNoticeText({ ...done, summaryOutcome: "timeout" })).toBe(
      "Trimmed 12 older turns (summary timed out)",
    );
    expect(
      compactionNoticeText({ ...done, summaryOutcome: "no-deployment" }),
    ).toBe("Trimmed 12 older turns (no summarizer deployment)");
  });

  it("keeps the singular singular", () => {
    expect(
      compactionNoticeText({
        status: "done",
        trimmedTurns: 1,
        tokensBefore: 2_000,
        tokensAfter: 1_000,
        summaryOutcome: "ok",
        durationMs: 1,
      }),
    ).toContain("1 older turn into");
    expect(compactionMarkerText(1)).toBe("Conversation compacted here · 1 older turn");
    expect(compactionMarkerText(9)).toBe("Conversation compacted here · 9 older turns");
  });
});

describe("chat-page.unit.compaction-part.003 — the persisted marker", () => {
  it("keeps only what the divider renders", () => {
    expect(
      threadCompactionMarker({
        coversThroughMessageId: "m42",
        content: "  FACTS: metric units.  ",
        model: "terra-dep",
      }),
    ).toEqual({
      coversThroughMessageId: "m42",
      summaryText: "FACTS: metric units.",
      summaryModel: "terra-dep",
    });
  });

  it("is still a marker with no summary text, but carries no model label", () => {
    // Trimmed with the feature off: the turns are gone from the prompt, there
    // is just nothing to expand.
    expect(
      threadCompactionMarker({ coversThroughMessageId: "m42", content: "", model: "x" }),
    ).toEqual({ coversThroughMessageId: "m42" });
  });

  it("is null without a watermark (negative)", () => {
    expect(threadCompactionMarker(null)).toBeNull();
    expect(threadCompactionMarker(undefined)).toBeNull();
    expect(threadCompactionMarker({ content: "text" })).toBeNull();
    expect(threadCompactionMarker({ coversThroughMessageId: "" })).toBeNull();
  });
});

describe("chat-page.unit.compaction-part.004 — divider placement", () => {
  const messages = [
    { id: "u1", role: "user" },
    { id: "a1", role: "assistant" },
    { id: "u2", role: "user" },
    { id: "a2", role: "assistant" },
    { id: "u3", role: "user" },
    { id: "a3", role: "assistant" },
  ];

  it("puts the divider on the watermark row and counts the turns before it", () => {
    const placement = compactionMarkerPlacement({
      marker: { coversThroughMessageId: "a2" },
      messages,
    });
    // The position IS the summary row's coversThroughMessageId.
    expect(placement).toEqual({ afterMessageId: "a2", trimmedTurns: 2 });
  });

  it("counts the watermark's own turn when the watermark is the user row", () => {
    expect(
      compactionMarkerPlacement({
        marker: { coversThroughMessageId: "u3" },
        messages,
      }),
    ).toEqual({ afterMessageId: "u3", trimmedTurns: 3 });
  });

  it("draws nothing when the watermark row is gone (negative, fail open)", () => {
    // The user rewound or deleted messages. A divider in the wrong place would
    // claim the model has forgotten turns it can still read.
    expect(
      compactionMarkerPlacement({
        marker: { coversThroughMessageId: "deleted-row" },
        messages,
      }),
    ).toBeNull();
    expect(compactionMarkerPlacement({ marker: null, messages })).toBeNull();
    expect(
      compactionMarkerPlacement({
        marker: { coversThroughMessageId: "a2" },
        messages: [],
      }),
    ).toBeNull();
  });
});
