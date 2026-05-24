import { scoreCandidate } from "../scoring.js";
import type { AlgorithmStrategy } from "../types.js";

// The default strategy: a transparent linear weighted sum of every scoring
// signal. This is the auditable baseline — `total` is simply the dot product
// of the config weights and the per-signal scores (see scoreCandidate).
export const weightedSumStrategy: AlgorithmStrategy = {
  id: "weighted-sum",
  label: "Weighted sum",
  description:
    "Transparent linear blend of every signal (distance, activity, goals, interests, reciprocity, age, completeness, fairness).",
  score(viewer, candidate, config, now) {
    return scoreCandidate(viewer, candidate, config, now);
  },
};
