import { dailyRandom } from "./random.js";
import type {
  AlgorithmConfig,
  Candidate,
  ProfilePublicFields,
  RelationshipGoal,
  ScoreBreakdown,
  SoftPreferenceSnapshot,
  Viewer,
} from "./types.js";

export function distanceScore(distanceKm: number, maxDistanceKm: number): number {
  if (maxDistanceKm <= 0) return 0;
  const raw = 1 - distanceKm / maxDistanceKm;
  return Math.max(0.25, Math.min(1, raw));
}

export function activityScore(candidate: Candidate, config: AlgorithmConfig): number {
  return config.activityBuckets[candidate.activityBucket];
}

export function preferenceOverlapScore(soft: SoftPreferenceSnapshot): number {
  const entries = Object.values(soft).filter((v) => v !== undefined) as boolean[];
  if (entries.length === 0) return 0.5;
  const matched = entries.filter((v) => v === true).length;
  return matched / entries.length;
}

export function relationshipGoalScore(
  viewerGoal: RelationshipGoal | null,
  candidateGoal: RelationshipGoal | null,
  config: AlgorithmConfig,
): number {
  if (viewerGoal === null || candidateGoal === null) return 0.5;
  const row = config.relationshipGoalCompatibility[viewerGoal];
  if (!row) return 0.5;
  const value = row[candidateGoal];
  return typeof value === "number" ? value : 0.5;
}

export function profileCompletenessScore(
  fields: ProfilePublicFields,
  recommendedKeys: string[],
): number {
  const mapping: Record<string, keyof ProfilePublicFields> = {
    photosAtLeastTwo: "hasPhotosAtLeastTwo",
    displayName: "hasDisplayName",
    age: "hasAge",
    gender: "hasGender",
    bioAtLeast30Chars: "hasBioAtLeast30Chars",
    atLeastOnePrompt: "hasAtLeastOnePrompt",
    atLeastThreeInterests: "hasAtLeastThreeInterests",
    relationshipGoal: "hasRelationshipGoal",
    educationLevel: "hasEducationLevel",
    city: "hasCity",
  };
  let completed = 0;
  let denominator = 0;
  for (const key of recommendedKeys) {
    const field = mapping[key];
    if (!field) continue;
    denominator += 1;
    if (fields[field]) completed += 1;
  }
  if (denominator === 0) return 0;
  return Math.min(1, completed / denominator);
}

// Jaccard overlap of two interest lists, case-insensitive. Returns 0 when
// either side has no interests (no signal), 1 when the sets are identical.
export function sharedInterestsScore(
  viewerInterests: string[],
  candidateInterests: string[],
): number {
  if (viewerInterests.length === 0 || candidateInterests.length === 0) return 0;
  const a = new Set(viewerInterests.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const b = new Set(candidateInterests.map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Two-sided desirability: rewards candidates who are also looking for someone
// like the viewer. Half the score is gender reciprocity (does the candidate
// want the viewer's gender?), half is age reciprocity (does the viewer's age
// fall in the candidate's preferred range?). Raises match-likelihood rather
// than one-way attraction. Empty candidate gender prefs count as open (1.0).
export function reciprocityScore(viewer: Viewer, candidate: Candidate): number {
  const wantsGender =
    candidate.profile.interestedInGenders.length === 0 ||
    candidate.profile.interestedInGenders.includes(viewer.profile.gender);
  const [candMin, candMax] = candidate.profile.candidatePreferredAgeRange;
  const wantsAge = viewer.profile.age >= candMin && viewer.profile.age <= candMax;
  return (wantsGender ? 0.5 : 0) + (wantsAge ? 0.5 : 0);
}

// Age proximity within the viewer's accepted window. Same age scores 1; the
// score decays linearly with the age gap, normalized by the width of the
// viewer's [minAge, maxAge] window so wide-window viewers are penalized less.
export function ageProximityScore(
  viewerAge: number,
  candidateAge: number,
  minAge: number,
  maxAge: number,
): number {
  const window = Math.max(maxAge - minAge, 1);
  const gap = Math.abs(viewerAge - candidateAge);
  return Math.max(0, Math.min(1, 1 - gap / window));
}

export function fairnessRotationScore(recentImpressions: number, config: AlgorithmConfig): number {
  const cap = config.constraints.fairnessImpressionCap;
  if (cap <= 0) return 1;
  return 1 - Math.min(1, recentImpressions / cap);
}

export function randomizationScore(
  viewerId: string,
  candidateId: string,
  algorithmVersion: string,
  now: Date,
): number {
  return dailyRandom(viewerId, candidateId, algorithmVersion, now);
}

export function scoreCandidate(
  viewer: Viewer,
  candidate: Candidate,
  config: AlgorithmConfig,
  now: Date,
): ScoreBreakdown {
  const w = config.weights;
  const distance = distanceScore(candidate.distanceKm, viewer.preferences.maxDistanceKm);
  const activity = activityScore(candidate, config);
  const preferenceOverlap = preferenceOverlapScore(candidate.softPreferences);
  const goal = relationshipGoalScore(
    viewer.profile.relationshipGoal,
    candidate.profile.relationshipGoal,
    config,
  );
  const completeness = profileCompletenessScore(
    candidate.profile.publicFields,
    config.recommendedCompletenessFields,
  );
  const sharedInterests = sharedInterestsScore(
    viewer.profile.interests,
    candidate.profile.interests,
  );
  const reciprocity = reciprocityScore(viewer, candidate);
  const ageProximity = ageProximityScore(
    viewer.profile.age,
    candidate.profile.age,
    viewer.preferences.minAge,
    viewer.preferences.maxAge,
  );
  const fairness = fairnessRotationScore(candidate.recentImpressions, config);
  const random = randomizationScore(
    viewer.userId,
    candidate.profile.userId,
    config.algorithmVersion,
    now,
  );

  const total =
    w.distance * distance +
    w.activity * activity +
    w.preferenceOverlap * preferenceOverlap +
    w.relationshipGoal * goal +
    w.profileCompleteness * completeness +
    w.sharedInterests * sharedInterests +
    w.reciprocity * reciprocity +
    w.ageProximity * ageProximity +
    w.fairnessRotation * fairness +
    w.randomization * random;

  return {
    distance,
    activity,
    preferenceOverlap,
    relationshipGoal: goal,
    profileCompleteness: completeness,
    sharedInterests,
    reciprocity,
    ageProximity,
    fairnessRotation: fairness,
    randomization: random,
    total,
  };
}
