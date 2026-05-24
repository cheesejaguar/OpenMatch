import { scoreCandidate } from "../scoring.js";
import type { AlgorithmStrategy } from "../types.js";

// A distinct, still-auditable strategy that emphasizes mutual fit. It takes
// the same weighted-sum breakdown, then multiplies the total by a reciprocity
// gate: a candidate the viewer would love but who would not want the viewer
// back is down-ranked, because such a swipe is unlikely to become a match.
//
// The gate maps the [0,1] reciprocity signal onto [floor, 1] so a fully
// non-reciprocal candidate is dampened (not zeroed — they may still have
// updated their own preferences). The per-signal breakdown is preserved for
// explainability; only `total` is transformed.
const RECIPROCITY_FLOOR = 0.4;

export const reciprocalStrategy: AlgorithmStrategy = {
  id: "reciprocal",
  label: "Reciprocal fit",
  description:
    "Weighted sum gated by two-sided desirability — favors candidates likely to like you back, improving match rate over raw attraction.",
  score(viewer, candidate, config, now) {
    const base = scoreCandidate(viewer, candidate, config, now);
    const gate = RECIPROCITY_FLOOR + (1 - RECIPROCITY_FLOOR) * base.reciprocity;
    return { ...base, total: base.total * gate };
  },
};
