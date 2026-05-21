import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentConfig } from "../src/config.js";
import { getDiscoveryDeck } from "../src/deck.js";
import {
  BuiltinRankingProvider,
  defaultRankingProvider,
  EngagementRankingProvider,
  LearnedRankingProvider,
} from "../src/ranking-provider.js";
import type { Candidate, Viewer } from "../src/types.js";
import { emptyBlocks, emptySwipes, FIXED_NOW, makeCandidates, makeViewer } from "./helpers.js";

// DISC-Q3 — concrete RankingProvider coverage.

describe("RankingProvider", () => {
  let viewer: Viewer;
  let candidates: Candidate[];

  beforeEach(() => {
    viewer = makeViewer("viewerSeekingLongTermMen");
    candidates = makeCandidates(viewer);
  });

  describe("BuiltinRankingProvider", () => {
    it("returns one entry per candidate, ranked DESC by total", () => {
      const provider = new BuiltinRankingProvider();
      const ranked = provider.rank({
        viewer,
        candidates,
        now: FIXED_NOW,
        config: currentConfig,
      });
      expect(ranked.length).toBe(candidates.length);
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1]!.breakdown.total).toBeGreaterThanOrEqual(ranked[i]!.breakdown.total);
      }
    });

    it("reproduces the pre-Plugin API deck order when used by getDiscoveryDeck", () => {
      // No provider supplied → builtin is the default inside the deck.
      const a = getDiscoveryDeck({
        viewer,
        candidates,
        blocks: emptyBlocks,
        priorSwipes: emptySwipes,
        now: FIXED_NOW,
        limit: 50,
        deckSessionId: "s",
      });
      const b = getDiscoveryDeck({
        viewer,
        candidates,
        blocks: emptyBlocks,
        priorSwipes: emptySwipes,
        now: FIXED_NOW,
        limit: 50,
        deckSessionId: "s",
        rankingProvider: new BuiltinRankingProvider(),
      });
      expect(b.cards.map((c) => c.userId)).toEqual(a.cards.map((c) => c.userId));
    });
  });

  describe("LearnedRankingProvider", () => {
    it("is a no-op wrapping the builtin provider", () => {
      const learned = new LearnedRankingProvider();
      const builtin = new BuiltinRankingProvider();
      const a = learned.rank({ viewer, candidates, now: FIXED_NOW, config: currentConfig });
      const b = builtin.rank({ viewer, candidates, now: FIXED_NOW, config: currentConfig });
      expect(a.map((e) => e.candidate.profile.userId)).toEqual(
        b.map((e) => e.candidate.profile.userId),
      );
    });

    it("identifies itself by name for telemetry", () => {
      expect(new LearnedRankingProvider().name).toBe("learned");
    });
  });

  describe("EngagementRankingProvider", () => {
    it("boosts candidates who were active in the last 7 days", () => {
      const provider = new EngagementRankingProvider();
      // Take two candidates with otherwise-equal scoring and flip
      // their last-active timestamps. The recent one should outrank.
      const recent = candidates[0]!;
      const stale = candidates[1]!;
      const now = FIXED_NOW.getTime();
      const adjusted: Candidate[] = [
        { ...recent, profile: { ...recent.profile, lastActiveAt: new Date(now - 3600_000) } },
        {
          ...stale,
          profile: { ...stale.profile, lastActiveAt: new Date(now - 60 * 24 * 3600_000) },
        },
      ];
      const ranked = provider.rank({
        viewer,
        candidates: adjusted,
        now: FIXED_NOW,
        config: currentConfig,
      });
      const recentRank = ranked.findIndex(
        (e) => e.candidate.profile.userId === recent.profile.userId,
      );
      const staleRank = ranked.findIndex(
        (e) => e.candidate.profile.userId === stale.profile.userId,
      );
      expect(recentRank).toBeLessThan(staleRank);
    });

    it("demotes candidates whose bio is shorter than 30 chars", () => {
      const provider = new EngagementRankingProvider();
      const richBio = candidates[0]!;
      const thinBio = candidates[1]!;
      const adjusted: Candidate[] = [
        {
          ...richBio,
          profile: {
            ...richBio.profile,
            publicFields: { ...richBio.profile.publicFields, hasBioAtLeast30Chars: true },
          },
        },
        {
          ...thinBio,
          profile: {
            ...thinBio.profile,
            publicFields: { ...thinBio.profile.publicFields, hasBioAtLeast30Chars: false },
          },
        },
      ];
      const ranked = provider.rank({
        viewer,
        candidates: adjusted,
        now: FIXED_NOW,
        config: currentConfig,
      });
      const richRank = ranked.findIndex(
        (e) => e.candidate.profile.userId === richBio.profile.userId,
      );
      const thinRank = ranked.findIndex(
        (e) => e.candidate.profile.userId === thinBio.profile.userId,
      );
      expect(richRank).toBeLessThan(thinRank);
    });

    it("boosts candidates with allPhotosReviewedOk = true", () => {
      const provider = new EngagementRankingProvider();
      const reviewed = candidates[0]!;
      const unreviewed = candidates[1]!;
      const adjusted: (Candidate & { engagementSignals?: { allPhotosReviewedOk?: boolean } })[] = [
        { ...reviewed, engagementSignals: { allPhotosReviewedOk: true } },
        { ...unreviewed, engagementSignals: { allPhotosReviewedOk: false } },
      ];
      const ranked = provider.rank({
        viewer,
        candidates: adjusted,
        now: FIXED_NOW,
        config: currentConfig,
      });
      const reviewedRank = ranked.findIndex(
        (e) => e.candidate.profile.userId === reviewed.profile.userId,
      );
      const unreviewedRank = ranked.findIndex(
        (e) => e.candidate.profile.userId === unreviewed.profile.userId,
      );
      expect(reviewedRank).toBeLessThan(unreviewedRank);
    });

    it("identifies itself by name for telemetry", () => {
      expect(new EngagementRankingProvider().name).toBe("engagement");
    });
  });

  describe("defaultRankingProvider()", () => {
    const original = process.env.OPENMATCH_RANKING_PROVIDER;

    afterEach(() => {
      if (original === undefined) {
        delete process.env.OPENMATCH_RANKING_PROVIDER;
      } else {
        process.env.OPENMATCH_RANKING_PROVIDER = original;
      }
    });

    it("defaults to EngagementRankingProvider when no env override is set", () => {
      delete process.env.OPENMATCH_RANKING_PROVIDER;
      expect(defaultRankingProvider().name).toBe("engagement");
    });

    it("honours OPENMATCH_RANKING_PROVIDER=builtin", () => {
      process.env.OPENMATCH_RANKING_PROVIDER = "builtin";
      expect(defaultRankingProvider().name).toBe("builtin");
    });

    it("honours OPENMATCH_RANKING_PROVIDER=learned", () => {
      process.env.OPENMATCH_RANKING_PROVIDER = "learned";
      expect(defaultRankingProvider().name).toBe("learned");
    });

    it("falls back to engagement on an unknown override", () => {
      process.env.OPENMATCH_RANKING_PROVIDER = "neural-vibes-2026";
      expect(defaultRankingProvider().name).toBe("engagement");
    });
  });

  it("getDiscoveryDeck threads the supplied provider through", () => {
    // Custom provider that ranks the second candidate first as a
    // sentinel. The deck must respect that order modulo the
    // diversification + limit pass.
    const sentinel = candidates[1]!;
    const provider = {
      name: "test-sentinel",
      rank() {
        return [
          {
            candidate: sentinel,
            breakdown: {
              distance: 1,
              activity: 1,
              preferenceOverlap: 1,
              relationshipGoal: 1,
              profileCompleteness: 1,
              fairnessRotation: 1,
              randomization: 1,
              total: 999,
            },
          },
        ];
      },
    };
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 50,
      deckSessionId: "s",
      rankingProvider: provider,
    });
    // The custom provider returned a single entry. The deck must
    // honour that decision (only sentinel survives the rank step).
    // Diversification can drop it only if there is a similar duplicate
    // — which there isn't, since we returned a 1-element list.
    expect(deck.cards.length).toBe(1);
    expect(deck.cards[0]!.userId).toBe(sentinel.profile.userId);
  });
});
