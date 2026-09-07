import { describe, it, expect } from "vitest";
import { computeRequestUsage, computeTokenCostUsd } from "./usage-data";

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

  it("carries the cache-write count through to the metadata block", () => {
    const u = computeRequestUsage({
      inputTokens: 1000,
      outputTokens: 0,
      cachedTokens: 400,
      cacheWriteTokens: 300,
      modelConfig,
    });
    expect(u.cacheWriteTokens).toBe(300);
  });

  it("defaults the cache-write count to 0 when the caller omits it", () => {
    const u = computeRequestUsage({
      inputTokens: 1000,
      outputTokens: 0,
      cachedTokens: 0,
      modelConfig,
    });
    expect(u.cacheWriteTokens).toBe(0);
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

describe("computeTokenCostUsd", () => {
  // GPT-5.6-shaped pricing: writes are surcharged at 1.25x uncached input.
  const solPricing = {
    inputPerMillion: 5,
    outputPerMillion: 30,
    cachedInputPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  };
  // Pre-5.6 pricing: no separate write price.
  const legacyPricing = {
    inputPerMillion: 5,
    outputPerMillion: 30,
    cachedInputPerMillion: 0.5,
  };

  it("splits input into uncached / cache-read / cache-write buckets", () => {
    const cost = computeTokenCostUsd({
      inputTokens: 10_000,
      outputTokens: 1_000,
      cachedTokens: 6_000,
      cacheWriteTokens: 3_000,
      pricing: solPricing,
    });
    // 1_000 uncached @5 + 6_000 read @0.5 + 3_000 write @6.25 + 1_000 out @30
    const expected =
      (1_000 / 1e6) * 5 + (6_000 / 1e6) * 0.5 + (3_000 / 1e6) * 6.25 + (1_000 / 1e6) * 30;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("costs a full cache write more than the same turn served from cache", () => {
    const write = computeTokenCostUsd({
      inputTokens: 10_000,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 10_000,
      pricing: solPricing,
    });
    const read = computeTokenCostUsd({
      inputTokens: 10_000,
      outputTokens: 0,
      cachedTokens: 10_000,
      cacheWriteTokens: 0,
      pricing: solPricing,
    });
    expect(write).toBeGreaterThan(read);
    // 1.25x the uncached input rate, i.e. 12.5x a cache read.
    expect(write / read).toBeCloseTo(12.5, 6);
  });

  it("ignores the write count for a model with no write price (negative)", () => {
    const withWrites = computeTokenCostUsd({
      inputTokens: 10_000,
      outputTokens: 0,
      cachedTokens: 2_000,
      cacheWriteTokens: 3_000,
      pricing: legacyPricing,
    });
    const withoutWrites = computeTokenCostUsd({
      inputTokens: 10_000,
      outputTokens: 0,
      cachedTokens: 2_000,
      pricing: legacyPricing,
    });
    expect(withWrites).toBe(withoutWrites);
  });

  it("clamps the uncached bucket at zero when cached + write exceed input", () => {
    const cost = computeTokenCostUsd({
      inputTokens: 1_000,
      outputTokens: 0,
      cachedTokens: 800,
      cacheWriteTokens: 800,
      pricing: solPricing,
    });
    expect(cost).toBeCloseTo((800 / 1e6) * 0.5 + (800 / 1e6) * 6.25, 12);
  });

  it("returns 0 when pricing is absent (negative)", () => {
    expect(
      computeTokenCostUsd({
        inputTokens: 10_000,
        outputTokens: 1_000,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        pricing: undefined,
      }),
    ).toBe(0);
  });
});
