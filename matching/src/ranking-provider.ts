// Plugin API — RankingProvider interface.
//
// A RankingProvider takes a viewer + the set of *eligible* candidates
// (the deck-builder has already applied hard filters via
// `checkEligibility`) and returns them re-ranked, optionally with a
// modified score breakdown attached to each entry.
//
// Forks who want to ship a learned model, a content-moderation-aware
// re-ranker, or a paid-feature boost layer drop in their own
// RankingProvider without touching the open-source deck path. The
// builtin (rule-based) provider matches today's behaviour exactly so
// the default deck is unchanged.
//
// Lane coordination — this file ships alongside the Plugin API lane;
// the single `rank(input)` shape matches the maintainer's reflection.
// If the Plugin API lane has its own copy, treat that one as canonical
// and re-export from there.

import { currentConfig } from "./config.js";
import { scoreCandidate } from "./scoring.js";
import type {
  AlgorithmConfig,
  AlgorithmStrategy,
  Candidate,
  ScoreBreakdown,
  Viewer,
} from "./types.js";

export interface RankingProviderInput {
  viewer: Viewer;
  candidates: Candidate[];
  now: Date;
  config: AlgorithmConfig;
}

export interface RankedEntry {
  candidate: Candidate;
  breakdown: ScoreBreakdown;
}

export interface RankingProvider {
  /** Stable identifier for telemetry / config / explanations. */
  readonly name: string;
  /**
   * Re-rank the candidate pool. The returned entries should be in
   * descending order by `breakdown.total`. The deck-builder applies
   * its own diversification + limit on top of this output.
   */
  rank(input: RankingProviderInput): RankedEntry[];
}

/**
 * The default rule-based provider. Behaviour matches the pre-Plugin
 * API code path exactly so swapping providers is a no-op for callers
 * who don't override.
 */
export class BuiltinRankingProvider implements RankingProvider {
  readonly name = "builtin";

  rank(input: RankingProviderInput): RankedEntry[] {
    const out: RankedEntry[] = [];
    for (const candidate of input.candidates) {
      const breakdown = scoreCandidate(input.viewer, candidate, input.config, input.now);
      out.push({ candidate, breakdown });
    }
    out.sort((a, b) => b.breakdown.total - a.breakdown.total);
    return out;
  }
}

/**
 * Bridges the strategy registry (user-selectable, admin-curated weight
 * presets — see strategies/registry + presets) into the RankingProvider
 * seam. Scores each eligible candidate with the given AlgorithmStrategy and
 * returns them sorted by total. `StrategyRankingProvider(weightedSumStrategy)`
 * produces byte-for-byte the same output as BuiltinRankingProvider; other
 * strategies (e.g. reciprocal) or preset-resolved weights re-rank from here.
 */
export class StrategyRankingProvider implements RankingProvider {
  readonly name: string;
  constructor(private readonly strategy: AlgorithmStrategy) {
    this.name = strategy.id;
  }

  rank(input: RankingProviderInput): RankedEntry[] {
    const out: RankedEntry[] = [];
    for (const candidate of input.candidates) {
      const breakdown = this.strategy.score(input.viewer, candidate, input.config, input.now);
      out.push({ candidate, breakdown });
    }
    out.sort((a, b) => b.breakdown.total - a.breakdown.total);
    return out;
  }
}

/**
 * Placeholder for a future ML-backed re-ranker. Today it is a no-op
 * that delegates to the builtin provider — the named class exists so a
 * fork can drop in a model behind the same interface without changing
 * the wiring on the call site.
 */
export class LearnedRankingProvider implements RankingProvider {
  readonly name = "learned";
  private readonly inner = new BuiltinRankingProvider();

  rank(input: RankingProviderInput): RankedEntry[] {
    return this.inner.rank(input);
  }
}

const ENGAGEMENT_RECENTLY_ACTIVE_HOURS = 24 * 7;
const ENGAGEMENT_RECENTLY_ACTIVE_BOOST = 0.08;
const ENGAGEMENT_INCOMPLETE_BIO_DEMOTION = 0.06;
const ENGAGEMENT_REVIEWED_OK_BOOST = 0.04;
const ENGAGEMENT_MIN_BIO_LENGTH = 30;

/**
 * Engagement-aware provider. Wraps the builtin scoring with three
 * signal nudges:
 *   * +boost for candidates whose `Profile.lastActiveAt` is inside the
 *     trailing 7 days (re-engages dormant pools, rewards live users).
 *   * −demote for candidates whose bio is shorter than 30 chars (proxy
 *     for "low-effort or just-signed-up profile" — we still surface
 *     them, just below their more-complete peers).
 *   * +boost when every candidate photo is `moderationStatus =
 *     'reviewed_ok'` (signals a moderator has already vetted the
 *     gallery; complements the existing completeness term).
 *
 * The candidate `profile.publicFields.hasBioAtLeast30Chars` and
 * `profile.publicFields.hasPhotosAtLeastTwo` are already populated by
 * the caller; for the photo-moderation signal we rely on an optional
 * `candidate.engagementSignals?.allPhotosReviewedOk` flag that the
 * backend hydrator can set when it knows the answer. Absent flag is
 * treated as "unknown" (no boost / no demotion).
 */
export class EngagementRankingProvider implements RankingProvider {
  readonly name = "engagement";
  private readonly inner = new BuiltinRankingProvider();

  rank(input: RankingProviderInput): RankedEntry[] {
    const base = this.inner.rank(input);
    const nowMs = input.now.getTime();

    for (const entry of base) {
      let delta = 0;

      // +boost: active in the last 7 days.
      const lastActiveMs = entry.candidate.profile.lastActiveAt.getTime();
      const hoursSince = (nowMs - lastActiveMs) / 3_600_000;
      if (hoursSince <= ENGAGEMENT_RECENTLY_ACTIVE_HOURS) {
        delta += ENGAGEMENT_RECENTLY_ACTIVE_BOOST;
      }

      // −demote: short bio (Profile.bio.length < 30). The caller
      // populates `hasBioAtLeast30Chars` from the actual bio length so
      // this stays in lockstep with the source-of-truth string.
      if (!entry.candidate.profile.publicFields.hasBioAtLeast30Chars) {
        delta -= ENGAGEMENT_INCOMPLETE_BIO_DEMOTION;
      }

      // +boost: all photos reviewed-ok. Signal is optional so forks
      // that don't surface photo moderation see no effect.
      const signals = (
        entry.candidate as Candidate & {
          engagementSignals?: { allPhotosReviewedOk?: boolean };
        }
      ).engagementSignals;
      if (signals?.allPhotosReviewedOk === true) {
        delta += ENGAGEMENT_REVIEWED_OK_BOOST;
      }

      entry.breakdown = {
        ...entry.breakdown,
        total: entry.breakdown.total + delta,
      };
    }

    base.sort((a, b) => b.breakdown.total - a.breakdown.total);
    return base;
  }
}

/**
 * Re-export the public surface the deck-builder needs so callers can
 * import a single `ranking-provider` module rather than reaching into
 * `./scoring`.
 */
export const ENGAGEMENT_MIN_BIO_LENGTH_EXPORT = ENGAGEMENT_MIN_BIO_LENGTH;

/**
 * Default provider selection. Env-aware so a fork can flip the wiring
 * without recompiling. The default in production is
 * `EngagementRankingProvider`; `Builtin` remains available as the
 * fallback explicitly named via `OPENMATCH_RANKING_PROVIDER=builtin`.
 *
 * The matching package itself has no opinion on env vars; this helper
 * reads `process.env` only when invoked, so test code that imports the
 * symbol but never calls it pays nothing.
 */
export function defaultRankingProvider(): RankingProvider {
  const override =
    typeof process !== "undefined" && process.env
      ? process.env.OPENMATCH_RANKING_PROVIDER
      : undefined;
  switch (override) {
    case "builtin":
      return new BuiltinRankingProvider();
    case "learned":
      return new LearnedRankingProvider();
    case "engagement":
    case undefined:
    case "":
      return new EngagementRankingProvider();
    default:
      // Unknown override → fall through to engagement (the default)
      // rather than crash. The caller's tests can still construct an
      // explicit provider; production should never hit this branch.
      return new EngagementRankingProvider();
  }
}

// Re-export the builtin scoring helper for callers that want to keep
// the canonical algorithm output reachable without depending on the
// provider interface.
export { scoreCandidate } from "./scoring.js";
export { currentConfig };
