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
  // Selected core values (catalog keys). Drives values-overlap scoring and
  // the "you both value …" explanation. Defaults to [] when unset.
  values: string[];
  // Optional global desirability in [0,1] (e.g. normalized incoming-like
  // rate), populated by the caller. Used for desirability-balanced matching;
  // absent → treated as neutral.
  desirability?: number;
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
  // Optional historical response/continuation rate in [0,1] for this
  // candidate (how often they reply / want to continue), populated by the
  // caller. Used for responsiveness-aware ranking; absent → treated as
  // neutral so new users aren't penalized.
  responseRate?: number;
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
  sharedInterests: number;
  reciprocity: number;
  ageProximity: number;
  valuesOverlap: number;
  desirabilityBalance: number;
  responseLikelihood: number;
  fairnessRotation: number;
  randomization: number;
}

// The set of weight keys, used for validation and normalization. Keeping a
// runtime array (not just the type) lets backends validate admin-supplied
// weight maps without hand-maintaining a second list.
export const WEIGHT_KEYS: readonly (keyof RankingWeights)[] = [
  "distance",
  "activity",
  "preferenceOverlap",
  "relationshipGoal",
  "profileCompleteness",
  "sharedInterests",
  "reciprocity",
  "ageProximity",
  "valuesOverlap",
  "desirabilityBalance",
  "responseLikelihood",
  "fairnessRotation",
  "randomization",
] as const;

export interface AlgorithmConfig {
  algorithmVersion: string;
  rankingConfigVersion: string;
  // Optional: when a config was produced by resolveConfig from a preset that
  // pins a strategy, the chosen strategy id is recorded here. The shipped
  // base config omits it (defaults to the weighted-sum strategy).
  strategyId?: string;
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
  sharedInterests: number;
  reciprocity: number;
  ageProximity: number;
  valuesOverlap: number;
  desirabilityBalance: number;
  responseLikelihood: number;
  fairnessRotation: number;
  randomization: number;
  total: number;
}

// A pluggable ranking strategy. Strategies turn a (viewer, candidate) pair
// into a ScoreBreakdown given a config. The deck assembler picks one by id
// from the registry; the weighted-sum strategy is the default. Strategies
// must stay pure and deterministic so decks remain auditable and testable.
export interface AlgorithmStrategy {
  id: string;
  label: string;
  description: string;
  score(viewer: Viewer, candidate: Candidate, config: AlgorithmConfig, now: Date): ScoreBreakdown;
}

// A named, selectable weight preset. `weights` is a partial overlay on the
// base config's weights; unspecified keys inherit the base. `strategyId`
// optionally pins the preset to a specific strategy.
export interface WeightPreset {
  key: string;
  label: string;
  description: string;
  strategyId: string;
  weights: Partial<RankingWeights>;
}

// Options for resolveConfig: pick a preset and/or pin a strategy and/or
// overlay ad-hoc weight overrides (admin-supplied). All optional.
export interface ResolveConfigOptions {
  presetKey?: string;
  strategyId?: string;
  weightOverrides?: Partial<RankingWeights>;
  presets?: WeightPreset[];
}

export type ExplanationKey =
  | "withinDistance"
  | "mutualGenderPreference"
  | "sameRelationshipGoal"
  | "compatibleRelationshipGoal"
  | "sharedInterests"
  | "sharedValues"
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
  strategyId: string;
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
  // Plugin API — optional custom ranking provider. When supplied it wins
  // over strategyId. The provider interface lives in `ranking-provider.ts`;
  // we keep the import out of this types module to avoid a runtime/value
  // dependency on the type-only file.
  rankingProvider?: import("./ranking-provider.js").RankingProvider;
  // Selects a registered ranking strategy (see strategies/registry). Used
  // when no rankingProvider is supplied; defaults to the weighted-sum
  // strategy when omitted or unknown. A resolved preset config may also pin
  // a strategy via config.strategyId.
  strategyId?: string;
}
