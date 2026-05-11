// Plain TypeScript types for the matching package. No dependency on Prisma,
// Fastify, or anything backend-specific. Backends adapt their entities to
// these shapes before calling getDiscoveryDeck.

export type UserId = string;
export type ProfileId = string;

export type Gender =
  | "Woman"
  | "Man"
  | "NonBinary"
  | "TransWoman"
  | "TransMan"
  | "Genderqueer"
  | "Agender"
  | "Questioning"
  | "SelfDescribe"
  | "PreferNotToSay";

export type RelationshipGoal =
  | "LongTerm"
  | "LifePartner"
  | "ShortTerm"
  | "Casual"
  | "Friendship"
  | "Figuring"
  | "Marriage"
  | "NonMono"
  | "Open";

export type ActivityBucket = "within24h" | "within7d" | "within30d" | "older";

export type AccountStatus = "active" | "paused" | "banned" | "deleted";
export type VisibilityStatus = "visible" | "hidden";
export type ModerationStatus = "clean" | "reviewed_ok" | "under_review" | "restricted" | "removed";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ProfilePublicFields {
  hasPhotosAtLeastTwo: boolean;
  hasDisplayName: boolean;
  hasAge: boolean;
  hasGender: boolean;
  hasBioAtLeast30Chars: boolean;
  hasAtLeastOnePrompt: boolean;
  hasAtLeastThreeInterests: boolean;
  hasRelationshipGoal: boolean;
  hasEducationLevel: boolean;
  hasCity: boolean;
}

export interface SoftPreferenceSnapshot {
  // viewer's soft preferences with candidate values; absent fields mean
  // "viewer did not express a soft preference here".
  // Each value is true if candidate matches, false if candidate has a
  // different value, undefined if candidate did not answer.
  [field: string]: boolean | undefined;
}

export interface Profile {
  id: ProfileId;
  userId: UserId;
  displayName: string;
  age: number;
  gender: Gender;
  location: LatLng;
  city: string | null;
  relationshipGoal: RelationshipGoal | null;
  interests: string[];
  accountStatus: AccountStatus;
  visibilityStatus: VisibilityStatus;
  moderationStatus: ModerationStatus;
  lastActiveAt: Date;
  publicFields: ProfilePublicFields;

  // Visibility preferences — who the candidate wants to be shown to.
  interestedInGenders: Gender[];
  candidatePreferredAgeRange: [number, number];
}

export interface Preferences {
  userId: UserId;
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  interestedGenders: Gender[];
  relationshipGoals: RelationshipGoal[];
  // The viewer's soft preferences per candidate, populated by the caller
  // when invoking the deck function. The shape is intentionally generic
  // so new soft preferences can be added without breaking the package.
  excludeIncompatibleGoals: boolean;
  includeUnansweredOptionalFields: boolean;
}

export interface Viewer {
  userId: UserId;
  profile: Profile;
  preferences: Preferences;
}

export interface Candidate {
  profile: Profile;
  distanceKm: number;
  activityBucket: ActivityBucket;
  // Soft-preference comparison computed by the caller for this candidate
  // against the viewer's preferences.
  softPreferences: SoftPreferenceSnapshot;
  recentImpressions: number; // for fairness rotation
}

export interface Block {
  blockerId: UserId;
  blockedId: UserId;
}

export interface PriorSwipe {
  viewerId: UserId;
  targetUserId: UserId;
  decision: "like" | "reject";
  createdAt: Date;
  undoneAt: Date | null;
}

export interface RankingWeights {
  distance: number;
  activity: number;
  preferenceOverlap: number;
  relationshipGoal: number;
  profileCompleteness: number;
  fairnessRotation: number;
  randomization: number;
}

export interface AlgorithmConfig {
  algorithmVersion: string;
  rankingConfigVersion: string;
  weights: RankingWeights;
  constraints: {
    minimumAge: number;
    excludeBlockedUsers: boolean;
    excludeModerationRestrictedUsers: boolean;
    respectMutualGenderPreferences: boolean;
    respectHardFilters: boolean;
    rejectStickyDays: number;
    fairnessImpressionCap: number;
    fairnessImpressionWindowHours: number;
  };
  randomization: {
    method: string;
    seedInputs: string[];
  };
  relationshipGoalCompatibility: Record<RelationshipGoal, Record<RelationshipGoal, number>>;
  activityBuckets: Record<ActivityBucket, number>;
  recommendedCompletenessFields: string[];
}

export type EligibilityReason =
  | "self"
  | "blocked_by_viewer"
  | "blocked_by_candidate"
  | "moderation_restriction"
  | "already_acted_recently"
  | "out_of_distance_range"
  | "out_of_age_range"
  | "incompatible_gender_preference"
  | "incompatible_goal_filter"
  | "candidate_not_visible"
  | "candidate_not_active"
  | "underage";

export interface EligibilityResult {
  ok: boolean;
  reason?: EligibilityReason;
}

export interface ScoreBreakdown {
  distance: number;
  activity: number;
  preferenceOverlap: number;
  relationshipGoal: number;
  profileCompleteness: number;
  fairnessRotation: number;
  randomization: number;
  total: number;
}

export type ExplanationKey =
  | "withinDistance"
  | "mutualGenderPreference"
  | "sameRelationshipGoal"
  | "compatibleRelationshipGoal"
  | "sharedInterests"
  | "recentlyActive";

export interface Explanation {
  summary: string;
  keys: ExplanationKey[];
}

export interface DeckCard {
  profileId: ProfileId;
  userId: UserId;
  score: number;
  explanation: Explanation;
}

export interface DeckResponse {
  algorithmVersion: string;
  rankingConfigVersion: string;
  deckSessionId: string;
  cards: DeckCard[];
}

export interface DeckRequest {
  viewer: Viewer;
  candidates: Candidate[];
  blocks: Block[];
  priorSwipes: PriorSwipe[];
  now: Date;
  limit: number;
  deckSessionId: string;
  config?: AlgorithmConfig;
}
