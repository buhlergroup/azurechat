import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockLogError = vi.fn();
vi.mock("@/features/common/services/logger", () => ({
  logError: (...a: unknown[]) => mockLogError(...(a as [])),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

import {
  CODE_DEFAULT_MODEL,
  DEFAULT_MODEL,
  MODEL_CONFIGS,
  resolveDefaultModel,
} from "./models";

describe("resolveDefaultModel", () => {
  it("returns the code default when DEFAULT_MODEL_ID is unset", () => {
    expect(resolveDefaultModel(undefined)).toBe(CODE_DEFAULT_MODEL);
    expect(CODE_DEFAULT_MODEL).toBe("gpt-5.6-terra");
  });

  it("returns the code default for an empty or whitespace value", () => {
    expect(resolveDefaultModel("")).toBe(CODE_DEFAULT_MODEL);
    expect(resolveDefaultModel("   ")).toBe(CODE_DEFAULT_MODEL);
  });

  it("accepts any id present in MODEL_CONFIGS", () => {
    expect(resolveDefaultModel("gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(resolveDefaultModel("  gpt-5.5  ")).toBe("gpt-5.5");
  });

  it("ignores an unknown id and logs, rather than routing chats to a dead model (negative)", () => {
    mockLogError.mockClear();
    expect(resolveDefaultModel("gpt-9000")).toBe(CODE_DEFAULT_MODEL);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("DEFAULT_MODEL_ID"),
      expect.objectContaining({ value: "gpt-9000" }),
    );
  });

  it("does not accept inherited Object.prototype keys as model ids (negative)", () => {
    expect(resolveDefaultModel("toString")).toBe(CODE_DEFAULT_MODEL);
    expect(resolveDefaultModel("constructor")).toBe(CODE_DEFAULT_MODEL);
  });

  it("DEFAULT_MODEL is the code default in an environment with no override", () => {
    // The unit-test env sets no DEFAULT_MODEL_ID.
    expect(DEFAULT_MODEL).toBe(CODE_DEFAULT_MODEL);
    expect(MODEL_CONFIGS[DEFAULT_MODEL]).toBeDefined();
  });
});

describe("MODEL_CONFIGS — default reasoning effort", () => {
  it("puts the default model on medium effort and its siblings on low", () => {
    expect(MODEL_CONFIGS["gpt-5.6-terra"].defaultReasoningEffort).toBe("medium");
    expect(MODEL_CONFIGS["gpt-5.6-sol"].defaultReasoningEffort).toBe("low");
    expect(MODEL_CONFIGS["gpt-5.5"].defaultReasoningEffort).toBe("low");
  });
});
