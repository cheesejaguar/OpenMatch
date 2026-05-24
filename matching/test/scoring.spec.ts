import { describe, expect, it } from "vitest";
import { currentConfig } from "../src/config.js";
import {
  activityScore,
  ageProximityScore,
  distanceScore,
  fairnessRotationScore,
  preferenceOverlapScore,
  profileCompletenessScore,
  randomizationScore,
  reciprocityScore,
  relationshipGoalScore,
  scoreCandidate,
  sharedInterestsScore,
} from "../src/scoring.js";
import type { Candidate, Viewer } from "../src/types.js";
import { FIXED_NOW, makeCandidates, makeViewer } from "./helpers.js";

describe("distanceScore", () => {
  it("returns 1 at zero distance", () => {
    expect(distanceScore(0, 50)).toBe(1);
  });
  it("never goes below 0.25 within range", () => {
    expect(distanceScore(50, 50)).toBe(0.25);
    expect(distanceScore(49.9, 50)).toBe(0.25);
  });
  it("decreases monotonically with distance", () => {
    const near = distanceScore(2, 50);
    const far = distanceScore(20, 50);
    expect(near).toBeGreaterThan(far);
  });
});

describe("activityScore", () => {
  it("uses the configured bucket value", () => {
    const c = {
      activityBucket: "within24h",
    } as unknown as Candidate;
    expect(activityScore(c, currentConfig)).toBe(1.0);
    (c as { activityBucket: string }).activityBucket = "older";
    expect(activityScore(c, currentConfig)).toBe(0.2);
  });
});

describe("preferenceOverlapScore", () => {
  it("returns 0.5 when no preferences are expressed", () => {
    expect(preferenceOverlapScore({})).toBe(0.5);
    expect(preferenceOverlapScore({ a: undefined, b: undefined })).toBe(0.5);
  });
  it("returns the fraction of matched soft preferences", () => {
    expect(preferenceOverlapScore({ a: true, b: false, c: true })).toBeCloseTo(2 / 3, 5);
  });
});

describe("relationshipGoalScore", () => {
  it("is 1.0 when goals match", () => {
    expect(relationshipGoalScore("LongTerm", "LongTerm", currentConfig)).toBe(1);
  });
  it("uses the compatibility matrix", () => {
    expect(relationshipGoalScore("LongTerm", "LifePartner", currentConfig)).toBe(0.7);
    expect(relationshipGoalScore("LongTerm", "Casual", currentConfig)).toBe(0);
  });
  it("returns 0.5 when either goal is unknown", () => {
    expect(relationshipGoalScore(null, "LongTerm", currentConfig)).toBe(0.5);
    expect(relationshipGoalScore("LongTerm", null, currentConfig)).toBe(0.5);
  });
});

describe("profileCompletenessScore", () => {
  it("returns 1 when every recommended field is present", () => {
    const all = {
      hasPhotosAtLeastTwo: true,
      hasDisplayName: true,
      hasAge: true,
      hasGender: true,
      hasBioAtLeast30Chars: true,
      hasAtLeastOnePrompt: true,
      hasAtLeastThreeInterests: true,
      hasRelationshipGoal: true,
      hasEducationLevel: true,
      hasCity: true,
    };
    expect(profileCompletenessScore(all, currentConfig.recommendedCompletenessFields)).toBe(1);
  });
  it("returns 0 when nothing is filled in", () => {
    const none = {
      hasPhotosAtLeastTwo: false,
      hasDisplayName: false,
      hasAge: false,
      hasGender: false,
      hasBioAtLeast30Chars: false,
      hasAtLeastOnePrompt: false,
      hasAtLeastThreeInterests: false,
      hasRelationshipGoal: false,
      hasEducationLevel: false,
      hasCity: false,
    };
    expect(profileCompletenessScore(none, currentConfig.recommendedCompletenessFields)).toBe(0);
  });
});

describe("sharedInterestsScore", () => {
  it("is 0 when either side has no interests", () => {
    expect(sharedInterestsScore([], ["a"])).toBe(0);
    expect(sharedInterestsScore(["a"], [])).toBe(0);
  });
  it("is 1 for identical sets and Jaccard otherwise (case-insensitive)", () => {
    expect(sharedInterestsScore(["Hiking", "Coffee"], ["coffee", "hiking"])).toBe(1);
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 => 0.5
    expect(sharedInterestsScore(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5, 5);
  });
});

describe("reciprocityScore", () => {
  const mk = (gender: string, age: number, prefGenders: string[], range: [number, number]) =>
    ({
      profile: {
        gender,
        age,
        interestedInGenders: prefGenders,
        candidatePreferredAgeRange: range,
      },
    }) as unknown as { profile: Candidate["profile"] };

  it("is 1 when both gender and age are mutually wanted", () => {
    const viewer = mk("Woman", 30, [], [0, 0]) as unknown as Viewer;
    const candidate = mk("Man", 32, ["Woman"], [25, 35]) as unknown as Candidate;
    expect(reciprocityScore(viewer, candidate)).toBe(1);
  });
  it("gives 0.5 when only one side of the gate passes", () => {
    const viewer = mk("Woman", 50, [], [0, 0]) as unknown as Viewer;
    const candidate = mk("Man", 32, ["Woman"], [25, 35]) as unknown as Candidate; // age fails
    expect(reciprocityScore(viewer, candidate)).toBe(0.5);
  });
  it("treats empty candidate gender prefs as open", () => {
    const viewer = mk("NonBinary", 30, [], [0, 0]) as unknown as Viewer;
    const candidate = mk("Man", 32, [], [25, 35]) as unknown as Candidate;
    expect(reciprocityScore(viewer, candidate)).toBe(1);
  });
});

describe("ageProximityScore", () => {
  it("is 1 at the same age", () => {
    expect(ageProximityScore(30, 30, 25, 40)).toBe(1);
  });
  it("decays with the gap, normalized by the window width", () => {
    // window 15, gap 5 => 1 - 5/15
    expect(ageProximityScore(30, 35, 25, 40)).toBeCloseTo(1 - 5 / 15, 5);
  });
  it("never goes below 0", () => {
    expect(ageProximityScore(20, 60, 19, 25)).toBe(0);
  });
});

describe("fairnessRotationScore", () => {
  it("returns 1 for never-shown candidates", () => {
    expect(fairnessRotationScore(0, currentConfig)).toBe(1);
  });
  it("returns 0 when impressions are at or above the cap", () => {
    expect(
      fairnessRotationScore(currentConfig.constraints.fairnessImpressionCap, currentConfig),
    ).toBe(0);
    expect(
      fairnessRotationScore(currentConfig.constraints.fairnessImpressionCap + 50, currentConfig),
    ).toBe(0);
  });
});

describe("randomizationScore", () => {
  it("is deterministic across runs for fixed inputs", () => {
    const a = randomizationScore("v1", "c1", "discovery-v1.0.0", FIXED_NOW);
    const b = randomizationScore("v1", "c1", "discovery-v1.0.0", FIXED_NOW);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
  it("differs across viewer/candidate pairs", () => {
    const a = randomizationScore("v1", "c1", "discovery-v1.0.0", FIXED_NOW);
    const b = randomizationScore("v1", "c2", "discovery-v1.0.0", FIXED_NOW);
    expect(a).not.toBe(b);
  });
  it("differs across algorithm versions", () => {
    const a = randomizationScore("v1", "c1", "discovery-v1.0.0", FIXED_NOW);
    const b = randomizationScore("v1", "c1", "discovery-v2.0.0", FIXED_NOW);
    expect(a).not.toBe(b);
  });
});

describe("scoreCandidate", () => {
  it("returns a total in [0, 1]", () => {
    const viewer = makeViewer("viewerSeekingLongTermMen");
    const candidates = makeCandidates(viewer);
    for (const c of candidates) {
      const s = scoreCandidate(viewer, c, currentConfig, FIXED_NOW);
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(s.total).toBeLessThanOrEqual(1);
    }
  });
});
