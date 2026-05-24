// Mirror of WEIGHT_KEYS in matching/src/types.ts and the strategy ids in
// matching/src/strategies/registry.ts. The admin app is a separate Next.js
// project that does not depend on @openmatch/matching, so these are kept in
// sync by hand. The backend re-validates every weight key and strategy id, so
// a drift here only affects which inputs the UI offers — never what is stored.

export const WEIGHT_KEYS = [
  "distance",
  "activity",
  "preferenceOverlap",
  "relationshipGoal",
  "profileCompleteness",
  "sharedInterests",
  "reciprocity",
  "ageProximity",
  "fairnessRotation",
  "randomization",
] as const;

export type WeightKey = (typeof WEIGHT_KEYS)[number];

export const STRATEGY_OPTIONS = [
  { id: "weighted-sum", label: "Weighted sum" },
  { id: "reciprocal", label: "Reciprocal fit" },
] as const;
