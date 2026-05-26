import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PromptInputTextarea } from "./prompt-input";

describe("PromptInputTextarea", () => {
  it("uses a 16px mobile font size to prevent iOS Safari focus zoom", () => {
    render(<PromptInputTextarea placeholder="Type your message..." />);

    expect(screen.getByPlaceholderText("Type your message...")).toHaveClass(
      "text-base",
      "md:text-sm"
    );
  });
});
