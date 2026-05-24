export { currentConfig } from "./config.js";
export { getDiscoveryDeck } from "./deck.js";
export { checkEligibility } from "./eligibility.js";
export { explain } from "./explain.js";
export { BUILTIN_PRESETS, normalizeWeights, resolveConfig } from "./presets.js";
export {
  BuiltinRankingProvider,
  defaultRankingProvider,
  EngagementRankingProvider,
  LearnedRankingProvider,
  type RankedEntry,
  type RankingProvider,
  type RankingProviderInput,
  StrategyRankingProvider,
} from "./ranking-provider.js";
export {
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
} from "./scoring.js";
export { reciprocalStrategy } from "./strategies/reciprocal.js";
export {
  DEFAULT_STRATEGY_ID,
  getStrategy,
  hasStrategy,
  listStrategies,
  registerStrategy,
} from "./strategies/registry.js";
export { weightedSumStrategy } from "./strategies/weightedSum.js";
export type {
  AccountStatus,
  ActivityBucket,
  AlgorithmConfig,
  AlgorithmStrategy,
  Block,
  Candidate,
  DeckCard,
  DeckRequest,
  DeckResponse,
  EligibilityReason,
  EligibilityResult,
  Explanation,
  ExplanationKey,
  Gender,
  LatLng,
  ModerationStatus,
  Preferences,
  PriorSwipe,
  Profile,
  ProfileId,
  ProfilePublicFields,
  RankingWeights,
  RelationshipGoal,
  ResolveConfigOptions,
  ScoreBreakdown,
  SoftPreferenceSnapshot,
  UserId,
  Viewer,
  VisibilityStatus,
  WeightPreset,
} from "./types.js";
export { WEIGHT_KEYS } from "./types.js";
