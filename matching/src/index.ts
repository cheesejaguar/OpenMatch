export { currentConfig } from "./config.js";
export { getDiscoveryDeck } from "./deck.js";
export { checkEligibility } from "./eligibility.js";
export { explain } from "./explain.js";
export {
  activityScore,
  distanceScore,
  fairnessRotationScore,
  preferenceOverlapScore,
  profileCompletenessScore,
  randomizationScore,
  relationshipGoalScore,
  scoreCandidate,
} from "./scoring.js";
export type {
  AccountStatus,
  ActivityBucket,
  AlgorithmConfig,
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
  ScoreBreakdown,
  SoftPreferenceSnapshot,
  UserId,
  Viewer,
  VisibilityStatus,
} from "./types.js";
