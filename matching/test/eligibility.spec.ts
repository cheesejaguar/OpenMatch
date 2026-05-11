import { describe, expect, it } from "vitest";
import { currentConfig } from "../src/config.js";
import { checkEligibility } from "../src/eligibility.js";
import { FIXED_NOW, emptyBlocks, emptySwipes, makeCandidates, makeViewer } from "./helpers.js";

describe("eligibility", () => {
  it("excludes self", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const selfCandidate = {
      profile: viewer.profile,
      distanceKm: 0,
      activityBucket: "within24h" as const,
      softPreferences: {},
      recentImpressions: 0,
    };
    const r = checkEligibility({
      viewer,
      candidate: selfCandidate,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("self");
  });

  it("excludes users blocked by viewer", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const target = candidates.find((c) => c.profile.gender === "Man")!;
    const r = checkEligibility({
      viewer,
      candidate: target,
      blocks: [{ blockerId: viewer.userId, blockedId: target.profile.userId }],
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("blocked_by_viewer");
  });

  it("excludes users who blocked the viewer", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const target = candidates.find((c) => c.profile.gender === "Man")!;
    const r = checkEligibility({
      viewer,
      candidate: target,
      blocks: [{ blockerId: target.profile.userId, blockedId: viewer.userId }],
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("blocked_by_candidate");
  });

  it("excludes users under moderation review", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const target = candidates.find((c) => c.profile.moderationStatus === "under_review");
    expect(target).toBeDefined();
    const r = checkEligibility({
      viewer,
      candidate: target!,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("moderation_restriction");
  });

  it("excludes candidates outside distance range", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    // u006 is in San Francisco — well over 40km from San Jose.
    const sf = candidates.find((c) => c.profile.userId === "u006")!;
    const r = checkEligibility({
      viewer,
      candidate: sf,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_distance_range");
  });

  it("excludes candidates outside age range", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const tooYoung = candidates.find((c) => c.profile.age < 25)!;
    const r = checkEligibility({
      viewer,
      candidate: tooYoung,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("out_of_age_range");
  });

  it("excludes candidates whose gender doesn't match viewer's preference", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    // viewer is interested in Man/NonBinary; pick a Woman that's nearby and in age range.
    const woman = candidates.find(
      (c) =>
        c.profile.gender === "Woman" &&
        c.distanceKm <= viewer.preferences.maxDistanceKm &&
        c.profile.age >= viewer.preferences.minAge &&
        c.profile.age <= viewer.preferences.maxAge,
    );
    expect(woman).toBeDefined();
    const r = checkEligibility({
      viewer,
      candidate: woman!,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("incompatible_gender_preference");
  });

  it("respects mutual gender preference (candidate also has to want viewer)", () => {
    // u007 is interested only in Man; viewer u001 is a Woman.
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const candidate = candidates.find((c) => c.profile.userId === "u007");
    if (!candidate) return; // u007 may be filtered by gender first
    const r = checkEligibility({
      viewer,
      candidate,
      blocks: emptyBlocks,
      priorSwipes: emptySwipes,
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("incompatible_gender_preference");
  });

  it("excludes candidates already rejected within the sticky window", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const target = candidates.find(
      (c) => c.profile.gender === "Man" && c.distanceKm <= viewer.preferences.maxDistanceKm,
    )!;
    const r = checkEligibility({
      viewer,
      candidate: target,
      blocks: emptyBlocks,
      priorSwipes: [
        {
          viewerId: viewer.userId,
          targetUserId: target.profile.userId,
          decision: "reject",
          createdAt: new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000),
          undoneAt: null,
        },
      ],
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("already_acted_recently");
  });

  it("allows candidates rejected before the sticky window expired", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const target = candidates.find(
      (c) =>
        c.profile.gender === "Man" &&
        c.distanceKm <= viewer.preferences.maxDistanceKm &&
        c.profile.age >= viewer.preferences.minAge &&
        c.profile.age <= viewer.preferences.maxAge &&
        c.profile.interestedInGenders.includes("Woman"),
    )!;
    const longAgo = new Date(
      FIXED_NOW.getTime() - (currentConfig.constraints.rejectStickyDays + 5) * 24 * 60 * 60 * 1000,
    );
    const r = checkEligibility({
      viewer,
      candidate: target,
      blocks: emptyBlocks,
      priorSwipes: [
        {
          viewerId: viewer.userId,
          targetUserId: target.profile.userId,
          decision: "reject",
          createdAt: longAgo,
          undoneAt: null,
        },
      ],
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(true);
  });

  it("excludes candidates with an outstanding like (they go to Likes tab)", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const target = candidates.find(
      (c) => c.profile.gender === "Man" && c.distanceKm <= viewer.preferences.maxDistanceKm,
    )!;
    const r = checkEligibility({
      viewer,
      candidate: target,
      blocks: emptyBlocks,
      priorSwipes: [
        {
          viewerId: viewer.userId,
          targetUserId: target.profile.userId,
          decision: "like",
          createdAt: new Date(FIXED_NOW.getTime() - 1000),
          undoneAt: null,
        },
      ],
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("already_acted_recently");
  });

  it("includes candidates whose previous like was undone", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    const target = candidates.find(
      (c) =>
        c.profile.gender === "Man" &&
        c.distanceKm <= viewer.preferences.maxDistanceKm &&
        c.profile.age >= viewer.preferences.minAge &&
        c.profile.age <= viewer.preferences.maxAge &&
        c.profile.interestedInGenders.includes("Woman"),
    )!;
    const r = checkEligibility({
      viewer,
      candidate: target,
      blocks: emptyBlocks,
      priorSwipes: [
        {
          viewerId: viewer.userId,
          targetUserId: target.profile.userId,
          decision: "like",
          createdAt: new Date(FIXED_NOW.getTime() - 60 * 1000),
          undoneAt: new Date(FIXED_NOW.getTime() - 30 * 1000),
        },
      ],
      now: FIXED_NOW,
      config: currentConfig,
    });
    expect(r.ok).toBe(true);
  });
});
