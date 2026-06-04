import { describe, it, expect } from "vitest";
import { computeRequestUsage } from "./usage-data";

const modelConfig = {
  id: "gpt-5.5",
  pricing: { inputPerMillion: 5, outputPerMillion: 30, cachedInputPerMillion: 0.5 },
  contextWindow: 1_000_000,
} as const;

describe("computeRequestUsage", () => {
  it("totals tokens and bills cached input at the cached rate", () => {
    const u = computeRequestUsage({
      inputTokens: 1000,
      outputTokens: 200,
      cachedTokens: 400,
      modelConfig,
    });
    expect(u.totalTokens).toBe(1200);
    // (600/1e6)*5 + (400/1e6)*0.5 + (200/1e6)*30 = 0.003 + 0.0002 + 0.006
    expect(u.costUsd).toBeCloseTo(0.0092, 6);
    expect(u.model).toBe("gpt-5.5");
  });

  it("computes context usage percent against the model window", () => {
    const u = computeRequestUsage({
      inputTokens: 250_000,
      outputTokens: 0,
      cachedTokens: 0,
      modelConfig,
    });
    expect(u.contextWindowSize).toBe(1_000_000);
    expect(u.contextUsagePercent).toBeCloseTo(25, 6);
  });

  it("never bills negative non-cached input when cached exceeds input", () => {
    const u = computeRequestUsage({
      inputTokens: 100,
      outputTokens: 0,
      cachedTokens: 500,
      modelConfig,
    });
    // nonCachedInput clamps to 0; cost is just the cached portion.
    expect(u.costUsd).toBeCloseTo((500 / 1_000_000) * 0.5, 9);
  });

  it("yields zero cost and percent when pricing/window are absent", () => {
    const u = computeRequestUsage({
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      modelConfig: { id: "x", pricing: undefined as never, contextWindow: 0 },
    });
    expect(u.costUsd).toBe(0);
    expect(u.contextUsagePercent).toBe(0);
    expect(u.totalTokens).toBe(150);
  });
});
