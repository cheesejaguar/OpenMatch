import type { AlgorithmConfig, Candidate, Explanation, ExplanationKey, Viewer } from "./types.js";

const COPY: Record<ExplanationKey, (n?: number) => string> = {
  withinDistance: () => "Within your distance range.",
  mutualGenderPreference: () => "Matches your selected gender preference.",
  sameRelationshipGoal: () => "You both selected the same relationship goal.",
  compatibleRelationshipGoal: () => "Your relationship goals are compatible.",
  sharedInterests: (n) => (n && n > 0 ? `You share ${n} interest${n === 1 ? "" : "s"}.` : ""),
  recentlyActive: () => "This profile is active recently.",
};

export function explain(
  viewer: Viewer,
  candidate: Candidate,
  config: AlgorithmConfig,
): Explanation {
  const keys: ExplanationKey[] = [];
  const parts: string[] = [];

  if (candidate.distanceKm <= viewer.preferences.maxDistanceKm) {
    keys.push("withinDistance");
    parts.push(COPY.withinDistance());
  }

  if (
    viewer.preferences.interestedGenders.length === 0 ||
    viewer.preferences.interestedGenders.includes(candidate.profile.gender)
  ) {
    keys.push("mutualGenderPreference");
    parts.push(COPY.mutualGenderPreference());
  }

  const vGoal = viewer.profile.relationshipGoal;
  const cGoal = candidate.profile.relationshipGoal;
  if (vGoal && cGoal) {
    if (vGoal === cGoal) {
      keys.push("sameRelationshipGoal");
      parts.push(COPY.sameRelationshipGoal());
    } else {
      const compat = config.relationshipGoalCompatibility[vGoal]?.[cGoal] ?? 0;
      if (compat >= 0.7) {
        keys.push("compatibleRelationshipGoal");
        parts.push(COPY.compatibleRelationshipGoal());
      }
    }
  }

  const shared = countSharedInterests(viewer.profile.interests, candidate.profile.interests);
  if (shared > 0) {
    keys.push("sharedInterests");
    parts.push(COPY.sharedInterests(shared));
  }

  if (candidate.activityBucket === "within24h" || candidate.activityBucket === "within7d") {
    keys.push("recentlyActive");
    parts.push(COPY.recentlyActive());
  }

  // Never quote raw scores; never leak private fields. Fairness rotation
  // and randomization are intentionally absent from explanations because
  // they are not actionable to the viewer.
  return {
    summary: parts.filter(Boolean).join(" "),
    keys,
  };
}

function countSharedInterests(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(a.map((s) => s.toLowerCase()));
  let count = 0;
  for (const v of b) {
    if (set.has(v.toLowerCase())) count += 1;
  }
  return count;
}
