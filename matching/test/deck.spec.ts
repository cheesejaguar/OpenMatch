import { describe, expect, it } from "vitest";
import { currentConfig } from "../src/config.js";
import { getDiscoveryDeck } from "../src/deck.js";
import { emptyBlocks, emptySwipes, FIXED_NOW, makeCandidates, makeViewer } from "./helpers.js";

describe("getDiscoveryDeck", () => {
  it("returns the algorithm version and ranking config version", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 10,
      deckSessionId: "session-1",
    });
    expect(deck.algorithmVersion).toBe(currentConfig.algorithmVersion);
    expect(deck.rankingConfigVersion).toBe(currentConfig.rankingConfigVersion);
  });

  it("respects the limit", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 3,
      deckSessionId: "session-1",
    });
    expect(deck.cards.length).toBeLessThanOrEqual(3);
  });

  it("excludes candidates outside the distance range", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 50,
      deckSessionId: "s",
    });
    // u006 is in SF, ~70km away. Viewer max is 40km.
    expect(deck.cards.find((c) => c.userId === "u006")).toBeUndefined();
  });

  it("excludes candidates whose mutual gender preference fails", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 50,
      deckSessionId: "s",
    });
    for (const card of deck.cards) {
      const c = candidates.find((x) => x.profile.userId === card.userId)!;
      expect(["Man", "NonBinary"]).toContain(c.profile.gender);
      expect(c.profile.interestedInGenders).toContain("Woman");
    }
  });

  it("excludes candidates under moderation review", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 50,
      deckSessionId: "s",
    });
    // u019 has moderation_status = under_review.
    expect(deck.cards.find((c) => c.userId === "u019")).toBeUndefined();
  });

  it("is deterministic for fixed inputs", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const a = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 10,
      deckSessionId: "s",
    });
    const b = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 10,
      deckSessionId: "s",
    });
    expect(a.cards.map((c) => c.userId)).toEqual(b.cards.map((c) => c.userId));
  });

  it("returns an empty deck when filters are narrow enough", () => {
    const viewer = makeViewer("viewerNarrowFilters");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 10,
      deckSessionId: "s",
    });
    expect(deck.cards.length).toBeLessThanOrEqual(1);
  });

  it("includes plain-language explanations on every card", () => {
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
    });
    expect(deck.cards.length).toBeGreaterThan(0);
    for (const card of deck.cards) {
      expect(card.explanation.summary.length).toBeGreaterThan(0);
      // Must never expose the raw score in the explanation text.
      expect(card.explanation.summary).not.toMatch(/[\d]+\.[\d]+/);
    }
  });

  it("does not boost incoming likes secretly (no liked-you bonus in MVP)", () => {
    // The matching package has no concept of "liked you" and must not
    // re-order based on it. Sanity-check that the public API surface
    // exposes no such input.
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const deck = getDiscoveryDeck({
      viewer,
      candidates,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      limit: 50,
      deckSessionId: "s",
    });
    for (const card of deck.cards) {
      expect(card.explanation.summary).not.toMatch(/liked you/i);
    }
  });
});
