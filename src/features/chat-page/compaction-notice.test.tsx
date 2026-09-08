import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompactionMarker, CompactionNotice } from "./compaction-notice";

// The divider is the only thing that tells a user the model can no longer
// quote turns they can still scroll to, so these pin the words on screen.

describe("chat-page.unit.compaction-notice.001 — while it runs", () => {
  it("shows the running line and a spinner, with nothing to expand", () => {
    render(
      <CompactionNotice
        data={{ status: "running", turnsToTrim: 4, tokensBefore: 300_000 }}
      />,
    );
    expect(screen.getByText("Compacting older messages…")).toBeInTheDocument();
    // The Loader's inline SVG carries a title; a spinner is the whole point of
    // the running state.
    expect(screen.getByTitle("Loader")).toBeInTheDocument();
    expect(screen.queryByText("Show summary")).not.toBeInTheDocument();
  });
});

describe("chat-page.unit.compaction-notice.002 — when it is done", () => {
  const done = {
    status: "done" as const,
    trimmedTurns: 12,
    tokensBefore: 184_000,
    tokensAfter: 96_000,
    summaryOutcome: "ok" as const,
    summaryModel: "gpt-5.6-terra",
    durationMs: 4210,
    summaryText: "FACTS: the user prefers metric units.",
  };

  it("names the turns and the tokens, and stops spinning", () => {
    render(<CompactionNotice data={done} />);
    expect(
      screen.getByText("Compacted 12 older turns into a summary (184k → 96k tokens)"),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Loader")).not.toBeInTheDocument();
  });

  it("expands the summary on demand, and hides it again", async () => {
    const user = userEvent.setup();
    render(<CompactionNotice data={done} />);

    const toggle = screen.getByText("Show summary");
    expect(
      screen.queryByText("FACTS: the user prefers metric units."),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    expect(
      screen.getByText("FACTS: the user prefers metric units."),
    ).toBeInTheDocument();
    // The model that wrote it is labelled, so a bad summary can be traced.
    expect(screen.getByText("Summary by gpt-5.6-terra")).toBeInTheDocument();

    await user.click(screen.getByText("Hide summary"));
    expect(
      screen.queryByText("FACTS: the user prefers metric units."),
    ).not.toBeInTheDocument();
  });
});

describe("chat-page.unit.compaction-notice.003 — trimmed without a summary", () => {
  // One line per reason code. "feature off" for a broken summariser is what
  // hid a 404 on every trim behind a plausible-looking notice.
  it.each([
    ["off", "Trimmed 3 older turns (no summary, feature off)"],
    ["failed", "Trimmed 3 older turns (summary failed, see server log)"],
    ["timeout", "Trimmed 3 older turns (summary timed out)"],
    ["no-deployment", "Trimmed 3 older turns (no summarizer deployment)"],
  ] as const)("says why there is no summary (%s)", (summaryOutcome, expected) => {
    render(
      <CompactionNotice
        data={{
          status: "done",
          trimmedTurns: 3,
          tokensBefore: 90_000,
          tokensAfter: 50_000,
          summaryOutcome,
          durationMs: 12,
        }}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText("Show summary")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Loader")).not.toBeInTheDocument();
  });
});

describe("chat-page.unit.compaction-notice.004 — the persisted marker", () => {
  it("marks where the model's view of the conversation starts", () => {
    render(
      <CompactionMarker
        summaryModel="terra-dep"
        summaryText="FACTS: metric units."
        trimmedTurns={12}
      />,
    );
    expect(
      screen.getByText("Conversation compacted here · 12 older turns"),
    ).toBeInTheDocument();
    expect(screen.getByText("Show summary")).toBeInTheDocument();
    expect(screen.getByTestId("compaction-notice")).toBeInTheDocument();
  });

  it("renders without a summary to expand", () => {
    render(<CompactionMarker trimmedTurns={1} />);
    expect(
      screen.getByText("Conversation compacted here · 1 older turn"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Show summary")).not.toBeInTheDocument();
  });
});
