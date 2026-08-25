import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ToolCallHistorySidebar from "./tool-call-history-sidebar";

const baseTool = (overrides = {}) => ({
  name: "web_search",
  arguments: JSON.stringify({ query: "hello" }),
  result: "some result",
  timestamp: new Date("2024-01-01T12:00:00Z"),
  ...overrides,
});

describe("chat-page.unit.components — ToolCallHistorySidebar", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <ToolCallHistorySidebar
        open={false}
        onClose={vi.fn()}
        toolCallHistory={[baseTool()]}
        messageId="m1"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the sidebar with heading when open is true", () => {
    render(
      <ToolCallHistorySidebar
        open
        onClose={vi.fn()}
        toolCallHistory={[baseTool()]}
        messageId="m1"
      />
    );
    expect(screen.getByText("Tool Call History")).toBeInTheDocument();
  });

  it("shows empty-state message when toolCallHistory is empty", () => {
    render(
      <ToolCallHistorySidebar
        open
        onClose={vi.fn()}
        toolCallHistory={[]}
        messageId="m1"
      />
    );
    expect(screen.getByText(/no tool calls for this message/i)).toBeInTheDocument();
  });

  it("renders each tool call name", () => {
    render(
      <ToolCallHistorySidebar
        open
        onClose={vi.fn()}
        toolCallHistory={[baseTool({ name: "alpha" }), baseTool({ name: "beta" })]}
        messageId="m1"
      />
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  // Regression: extension tool keys are namespaced on the wire as
  // `${8-char-id-prefix}_${functionName}` (see buildExtensionToolKey in
  // chat-services/tools/registry.ts). This sidebar used to print
  // toolCall.name raw, leaking that dispatch key to the user.
  it("strips the extension-id-prefix namespace from a tool call name", () => {
    render(
      <ToolCallHistorySidebar
        open
        onClose={vi.fn()}
        toolCallHistory={[baseTool({ name: "Kj3nQ8xz_aisearch" })]}
        messageId="m1"
      />
    );
    expect(screen.getByText("aisearch")).toBeInTheDocument();
    expect(screen.queryByText("Kj3nQ8xz_aisearch")).not.toBeInTheDocument();
  });

  it("leaves a built-in tool call name unchanged", () => {
    render(
      <ToolCallHistorySidebar
        open
        onClose={vi.fn()}
        toolCallHistory={[baseTool({ name: "call_sub_agent" })]}
        messageId="m1"
      />
    );
    expect(screen.getByText("call_sub_agent")).toBeInTheDocument();
  });

  it("shows result truncated to 200 chars when result is present", () => {
    const longResult = "x".repeat(300);
    render(
      <ToolCallHistorySidebar
        open
        onClose={vi.fn()}
        toolCallHistory={[baseTool({ result: longResult })]}
        messageId="m1"
      />
    );
    // The component slices to 200 and appends "..."
    expect(screen.getByText(/^Result:/).textContent?.length).toBeLessThan(220);
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <ToolCallHistorySidebar
        open
        onClose={onClose}
        toolCallHistory={[baseTool()]}
        messageId="m1"
      />
    );
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <ToolCallHistorySidebar
        open
        onClose={onClose}
        toolCallHistory={[]}
        messageId="m1"
      />
    );
    // The overlay is the fixed inset-0 bg-black/30 div (first child of outer div)
    const overlay = container.querySelector(".fixed.inset-0.bg-black\\/30") as HTMLElement;
    if (overlay) await userEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });
});
