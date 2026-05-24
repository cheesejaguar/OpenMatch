import { describe, expect, it } from "vitest";
import { currentConfig } from "../src/config.js";
import { getDiscoveryDeck } from "../src/deck.js";
import { resolveConfig } from "../src/presets.js";
import {
  DEFAULT_STRATEGY_ID,
  getStrategy,
  hasStrategy,
  listStrategies,
  registerStrategy,
} from "../src/strategies/registry.js";
import type { AlgorithmStrategy } from "../src/types.js";
import { emptyBlocks, emptySwipes, FIXED_NOW, makeCandidates, makeViewer } from "./helpers.js";

describe("strategy registry", () => {
  it("ships the two built-in strategies", () => {
    expect(hasStrategy("weighted-sum")).toBe(true);
    expect(hasStrategy("reciprocal")).toBe(true);
    expect(listStrategies().map((s) => s.id)).toContain("weighted-sum");
  });

  it("defaults to weighted-sum for unknown or missing ids", () => {
    expect(getStrategy(undefined).id).toBe(DEFAULT_STRATEGY_ID);
    expect(getStrategy("does-not-exist").id).toBe(DEFAULT_STRATEGY_ID);
  });

  it("can register a new strategy without touching callers", () => {
    const noop: AlgorithmStrategy = {
      id: "test-noop",
      label: "noop",
      description: "test",
      score: (_v, _c, _cfg, _now) => ({
        distance: 0,
        activity: 0,
        preferenceOverlap: 0,
        relationshipGoal: 0,
        profileCompleteness: 0,
        sharedInterests: 0,
        reciprocity: 0,
        ageProximity: 0,
        fairnessRotation: 0,
        randomization: 0,
        total: 0,
      }),
    };
    registerStrategy(noop);
    expect(getStrategy("test-noop").id).toBe("test-noop");
  });
});

describe("getDiscoveryDeck strategy selection", () => {
  it("echoes the resolved strategy id", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 10,
      deckSessionId: "s",
      strategyId: "reciprocal",
    });
    expect(deck.strategyId).toBe("reciprocal");
  });

  it("honors a strategy pinned by a resolved preset config", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const config = resolveConfig(currentConfig, { presetKey: "serious-intent" });
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 10,
      deckSessionId: "s",
      config,
    });
    expect(deck.strategyId).toBe("reciprocal");
  });

  it("two presets score the same candidates differently", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const score = (presetKey: string) => {
      const cfg = resolveConfig(currentConfig, { presetKey });
      const strategy = getStrategy(cfg.strategyId);
      return candidates.map((c) => strategy.score(viewer, c, cfg, FIXED_NOW).total);
    };

    const balanced = score("balanced");
    const nearby = score("nearby-first");
    // Same candidate pool, same strategy, but the weighted totals must differ
    // under different weightings (otherwise the presets would be meaningless).
    expect(balanced).not.toEqual(nearby);
  });

  it("returns the same candidate set across presets (presets re-rank, not re-filter)", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const ids = (presetKey: string) =>
      getDiscoveryDeck({
        viewer,
        candidates,
        blocks: emptyBlocks,
        priorSwipes: emptySwipes,
        now: FIXED_NOW,
        limit: 50,
        deckSessionId: "s",
        config: resolveConfig(currentConfig, { presetKey }),
      })
        .cards.map((c) => c.userId)
        .sort();
    expect(ids("balanced")).toEqual(ids("nearby-first"));
  });
});
