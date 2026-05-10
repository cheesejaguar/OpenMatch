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
    w.fairnessRotation * fairness +
    w.randomization * random;

  return {
    distance,
    activity,
    preferenceOverlap,
    relationshipGoal: goal,
    profileCompleteness: completeness,
    fairnessRotation: fairness,
    randomization: random,
    total,
  };
}
