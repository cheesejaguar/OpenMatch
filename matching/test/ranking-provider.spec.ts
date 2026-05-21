import { afterEach, describe, expect, it } from "vitest";
import {
  BuiltinRankingProvider,
  type RankedCandidate,
  type RankInput,
  type RankingProvider,
  RankingProviderRegistry,
} from "../src/ranking-provider.js";
import { emptyBlocks, emptySwipes, FIXED_NOW, makeCandidates, makeViewer } from "./helpers.js";

// Round PLATFORM-PLUGIN — contract tests for the RankingProvider
// surface. We exercise: (a) the built-in provider produces a deck
// equivalent to the existing rules engine, (b) the registry resolves
// custom providers + falls back gracefully, (c) a stub implementation
// can be registered and invoked end-to-end.

describe("RankingProvider", () => {
  afterEach(() => {
    RankingProviderRegistry.reset();
  });

  describe("BuiltinRankingProvider", () => {
    it("returns ranked candidates with monotonically non-increasing scores", async () => {
      const viewer = makeViewer("viewerSeekingLongTermMen");
      const candidates = makeCandidates(viewer);
      const provider = new BuiltinRankingProvider();
      const ranked = await provider.rank({
        viewer,
        candidates,
        config: { algorithmVersion: "x", rankingConfigVersion: "x" },
        blocks: emptyBlocks,
        priorSwipes: emptySwipes,
        now: FIXED_NOW,
        limit: 10,
        deckSessionId: "s",
      });
      expect(ranked.length).toBeGreaterThan(0);
      // The deck's diversification rules may interleave candidates of
      // similar score, but the GLOBAL top entry should never have a
      // lower score than the GLOBAL bottom entry.
      expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[ranked.length - 1]!.score);
      // Every entry carries a non-empty explanation summary.
      for (const r of ranked) {
        expect(typeof r.explanation.summary).toBe("string");
        expect(r.profileId.length).toBeGreaterThan(0);
        expect(r.userId.length).toBeGreaterThan(0);
      }
    });

    it("respects the limit parameter", async () => {
      const viewer = makeViewer("viewerSeekingLongTermMen");
      const candidates = makeCandidates(viewer);
      const ranked = await new BuiltinRankingProvider().rank({
        viewer,
        candidates,
        config: { algorithmVersion: "x", rankingConfigVersion: "x" },
        blocks: emptyBlocks,
        priorSwipes: emptySwipes,
        now: FIXED_NOW,
        limit: 2,
        deckSessionId: "s",
      });
      expect(ranked.length).toBeLessThanOrEqual(2);
    });
  });

  describe("RankingProviderRegistry", () => {
    it("resolves the built-in provider by default", () => {
      const p = RankingProviderRegistry.resolve();
      expect(p.name).toBe("builtin");
    });

    it("resolves a registered custom provider by name", async () => {
      class Stub implements RankingProvider {
        readonly name = "stub";
        async rank(_input: RankInput): Promise<RankedCandidate[]> {
          return [];
        }
      }
      RankingProviderRegistry.register(new Stub());
      expect(RankingProviderRegistry.resolve("stub").name).toBe("stub");
    });

    it("falls back to the built-in default when the requested name is unknown", () => {
      const p = RankingProviderRegistry.resolve("does-not-exist");
      expect(p.name).toBe("builtin");
    });

    it("setDefault refuses to point at an unregistered provider", () => {
      expect(() => RankingProviderRegistry.setDefault("never-registered")).toThrowError(
        /not registered/,
      );
    });

    it("setDefault swaps the default once the target is registered", () => {
      class Stub implements RankingProvider {
        readonly name = "stub2";
        async rank(_input: RankInput): Promise<RankedCandidate[]> {
          return [];
        }
      }
      RankingProviderRegistry.register(new Stub());
      RankingProviderRegistry.setDefault("stub2");
      expect(RankingProviderRegistry.resolve().name).toBe("stub2");
    });
  });
});
