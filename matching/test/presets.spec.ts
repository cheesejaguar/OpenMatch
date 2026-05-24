import { describe, expect, it } from "vitest";
import { currentConfig } from "../src/config.js";
import { BUILTIN_PRESETS, normalizeWeights, resolveConfig } from "../src/presets.js";
import type { RankingWeights } from "../src/types.js";
import { WEIGHT_KEYS } from "../src/types.js";

function sum(w: RankingWeights): number {
  return WEIGHT_KEYS.reduce((acc, k) => acc + w[k], 0);
}

describe("normalizeWeights", () => {
  it("scales weights to sum to 1", () => {
    const w = { ...currentConfig.weights, distance: 2 };
    const n = normalizeWeights(w);
    expect(sum(n)).toBeCloseTo(1, 10);
  });

  it("leaves an all-zero map unchanged", () => {
    const zero = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0])) as RankingWeights;
    expect(sum(normalizeWeights(zero))).toBe(0);
  });
});

describe("resolveConfig", () => {
  it("returns normalized weights for every built-in preset", () => {
    for (const p of BUILTIN_PRESETS) {
      const cfg = resolveConfig(currentConfig, { presetKey: p.key });
      expect(sum(cfg.weights)).toBeCloseTo(1, 10);
    }
  });

  it("balanced resolves to the shipped base weights (normalized)", () => {
    const cfg = resolveConfig(currentConfig, { presetKey: "balanced" });
    // Base already sums to 1, so normalization is a no-op here.
    expect(cfg.weights.distance).toBeCloseTo(currentConfig.weights.distance, 10);
    expect(cfg.strategyId).toBe("weighted-sum");
  });

  it("preset overlay overrides only named keys", () => {
    const cfg = resolveConfig(currentConfig, { presetKey: "nearby-first" });
    // nearby-first cranks distance way up; relative to relationshipGoal it
    // should dominate after normalization.
    expect(cfg.weights.distance).toBeGreaterThan(cfg.weights.relationshipGoal);
  });

  it("weightOverrides win over the preset", () => {
    const cfg = resolveConfig(currentConfig, {
      presetKey: "nearby-first",
      weightOverrides: { distance: 0 },
    });
    expect(cfg.weights.distance).toBe(0);
  });

  it("records the strategy pinned by the preset", () => {
    expect(resolveConfig(currentConfig, { presetKey: "serious-intent" }).strategyId).toBe(
      "reciprocal",
    );
  });

  it("an explicit strategyId wins over the preset's", () => {
    const cfg = resolveConfig(currentConfig, {
      presetKey: "serious-intent",
      strategyId: "weighted-sum",
    });
    expect(cfg.strategyId).toBe("weighted-sum");
  });

  it("falls back to the default strategy when nothing is specified", () => {
    expect(resolveConfig(currentConfig).strategyId).toBe("weighted-sum");
  });
});
