import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/ui/markdown/markdown", () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

vi.mock("./citation/citation-action", () => ({
  CitationAction: vi.fn(),
}));

vi.mock("./chat-store", () => ({
  chatStore: {},
}));

vi.mock("./chat-image-display", () => ({
  ChatImageDisplay: ({ imageUrl, alt }: { imageUrl: string; alt: string }) => (
    <img src={imageUrl} alt={alt} />
  ),
}));

vi.mock("../ui/accordion", () => ({
  Accordion: ({ children }: any) => <div>{children}</div>,
  AccordionContent: ({ children }: any) => <div>{children}</div>,
  AccordionItem: ({ children }: any) => <div>{children}</div>,
  AccordionTrigger: ({ children }: any) => <button>{children}</button>,
}));

vi.mock("../ui/recursive-ui", () => ({
  RecursiveUI: ({ documentField }: any) => (
    <pre data-testid="recursive-ui">{JSON.stringify(documentField)}</pre>
  ),
}));

import MessageContent from "./message-content";

const assistantMsg = (overrides = {}) => ({
  id: "msg1",
  role: "assistant",
  content: "Hello from assistant",
  name: "AI",
  ...overrides,
});

describe("chat-page.unit.components — MessageContent", () => {
  it("renders markdown for an assistant message", () => {
    render(<MessageContent message={assistantMsg()} />);
    expect(screen.getByTestId("markdown")).toHaveTextContent("Hello from assistant");
  });

  it("renders markdown for a user message", () => {
    render(<MessageContent message={{ ...assistantMsg(), role: "user", content: "user text" }} />);
    expect(screen.getByTestId("markdown")).toHaveTextContent("user text");
  });

  it("renders reasoning accordion when reasoningContent is present for assistant", () => {
    render(
      <MessageContent
        message={assistantMsg({ reasoningContent: "my chain of thought" })}
      />
    );
    expect(screen.getByText(/reasoning output/i)).toBeInTheDocument();
    expect(screen.getByText("my chain of thought")).toBeInTheDocument();
  });

  it("does not render reasoning section for user message even if reasoningContent is set", () => {
    render(
      <MessageContent
        message={{ ...assistantMsg(), role: "user", reasoningContent: "ignored" }}
      />
    );
    expect(screen.queryByText(/reasoning output/i)).toBeNull();
  });

  it("renders ChatImageDisplay when multiModalImage is present", () => {
    render(
      <MessageContent
        message={assistantMsg({ multiModalImage: "https://example.com/img.png" })}
      />
    );
    expect(screen.getByRole("img", { name: "Chat image" })).toBeInTheDocument();
  });

  it("does not render img when multiModalImage is absent", () => {
    render(<MessageContent message={assistantMsg()} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders tool/function accordion for role=tool", () => {
    render(
      <MessageContent
        message={{
          id: "t1",
          role: "tool",
          content: JSON.stringify({ key: "value" }),
          name: "tool",
        }}
      />
    );
    expect(screen.getByText(/show tool output/i)).toBeInTheDocument();
    expect(screen.getByTestId("recursive-ui")).toBeInTheDocument();
  });

  it("renders function accordion for role=function", () => {
    render(
      <MessageContent
        message={{
          id: "f1",
          role: "function",
          content: '{"x":1}',
          name: "myFunc",
        }}
      />
    );
    expect(screen.getByText(/show myFunc function/i)).toBeInTheDocument();
  });

  it("renders null for unknown role", () => {
    const { container } = render(
      <MessageContent
        message={{ id: "x", role: "system", content: "sys msg", name: "system" }}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("handles non-JSON tool content gracefully", () => {
    render(
      <MessageContent
        message={{ id: "t2", role: "tool", content: "plain string", name: "tool" }}
      />
    );
    expect(screen.getByTestId("recursive-ui").textContent).toContain("plain string");
  });

  // Regression: role="tool" rows persist name as the namespaced extension
  // dispatch key (`${8-char-id-prefix}_${functionName}`, see
  // buildExtensionToolKey in chat-services/tools/registry.ts) — the stored
  // row is untouched, but the accordion label must show the authored
  // function name, not the internal key.
  it("strips the extension-id-prefix namespace from a persisted tool name", () => {
    render(
      <MessageContent
        message={{
          id: "t3",
          role: "tool",
          content: JSON.stringify({ key: "value" }),
          name: "Kj3nQ8xz_aisearch",
        }}
      />
    );
    expect(screen.getByText(/show aisearch function/i)).toBeInTheDocument();
    expect(screen.queryByText(/Kj3nQ8xz_aisearch/i)).toBeNull();
  });
});
