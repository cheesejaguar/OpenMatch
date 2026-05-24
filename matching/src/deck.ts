import { currentConfig } from "./config.js";
import { checkEligibility } from "./eligibility.js";
import { explain } from "./explain.js";
import { type RankingProvider, StrategyRankingProvider } from "./ranking-provider.js";
import { getStrategy } from "./strategies/registry.js";
import type { Candidate, DeckRequest, DeckResponse, ScoreBreakdown } from "./types.js";

interface RankedEntry {
  candidate: Candidate;
  breakdown: ScoreBreakdown;
}

// Diversification: avoid runs of very similar candidates without re-ordering
// by score. We slide forward the next dissimilar candidate when we'd
// otherwise place two consecutive cards from the same age bucket AND the
// same city.
function applyFairnessAndDiversityRules(ranked: RankedEntry[]): RankedEntry[] {
  if (ranked.length < 3) return ranked;
  const out: RankedEntry[] = [];
  const remaining = [...ranked];

  while (remaining.length > 0) {
    const last = out[out.length - 1];
    let pickIndex = 0;
    if (last) {
      pickIndex = remaining.findIndex((entry) => !isTooSimilar(last, entry));
      if (pickIndex === -1) pickIndex = 0;
    }
    out.push(remaining.splice(pickIndex, 1)[0]!);
  }
  return out;
}

function isTooSimilar(a: RankedEntry, b: RankedEntry): boolean {
  const sameAgeBucket = ageBucket(a.candidate.profile.age) === ageBucket(b.candidate.profile.age);
  const sameCity =
    a.candidate.profile.city !== null && a.candidate.profile.city === b.candidate.profile.city;
  return sameAgeBucket && sameCity;
}

function ageBucket(age: number): number {
  return Math.floor(age / 5);
}

export function getDiscoveryDeck(req: DeckRequest): DeckResponse {
  const config = req.config ?? currentConfig;
  // Provider precedence: an explicit rankingProvider (Plugin API — forks,
  // engagement re-rankers, learned models) wins. Otherwise we rank via the
  // selected strategy — a request-level strategyId, else one pinned by the
  // config (e.g. a resolved preset), else the registry default. The
  // weighted-sum strategy matches the pre-Plugin-API builtin output exactly.
  const strategy = getStrategy(req.strategyId ?? config.strategyId);
  const provider: RankingProvider = req.rankingProvider ?? new StrategyRankingProvider(strategy);

  const eligibleCandidates: Candidate[] = [];
  for (const candidate of req.candidates) {
    const elig = checkEligibility({
      viewer: req.viewer,
      candidate,
      blocks: req.blocks,
      priorSwipes: req.priorSwipes,
      now: req.now,
      config,
    });
    if (!elig.ok) continue;
    eligibleCandidates.push(candidate);
  }

  const ranked = provider.rank({
    viewer: req.viewer,
    candidates: eligibleCandidates,
    now: req.now,
    config,
  });

  const diversified = applyFairnessAndDiversityRules(ranked).slice(0, req.limit);

  return {
    algorithmVersion: config.algorithmVersion,
    rankingConfigVersion: config.rankingConfigVersion,
    // Report the effective ranking identity: a custom provider's name, else
    // the selected strategy id.
    strategyId: req.rankingProvider?.name ?? strategy.id,
    deckSessionId: req.deckSessionId,
    cards: diversified.map(({ candidate, breakdown }) => ({
      profileId: candidate.profile.id,
      userId: candidate.profile.userId,
      score: breakdown.total,
      explanation: explain(req.viewer, candidate, config),
    })),
  };
}
