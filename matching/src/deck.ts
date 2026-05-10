import { currentConfig } from "./config.js";
import { checkEligibility } from "./eligibility.js";
import { explain } from "./explain.js";
import { scoreCandidate } from "./scoring.js";
import type {
  Candidate,
  DeckRequest,
  DeckResponse,
  ScoreBreakdown,
} from "./types.js";

interface RankedEntry {
  candidate: Candidate;
  breakdown: ScoreBreakdown;
}

// Diversification: avoid runs of very similar candidates without re-ordering
// by score. We slide forward the next dissimilar candidate when we'd
// otherwise place two consecutive cards from the same age bucket AND the
// same city.
function applyFairnessAndDiversityRules(
  ranked: RankedEntry[],
): RankedEntry[] {
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
  const sameAgeBucket =
    ageBucket(a.candidate.profile.age) === ageBucket(b.candidate.profile.age);
  const sameCity =
    a.candidate.profile.city !== null &&
    a.candidate.profile.city === b.candidate.profile.city;
  return sameAgeBucket && sameCity;
}

function ageBucket(age: number): number {
  return Math.floor(age / 5);
}

export function getDiscoveryDeck(req: DeckRequest): DeckResponse {
  const config = req.config ?? currentConfig;

  const eligible: RankedEntry[] = [];
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
    const breakdown = scoreCandidate(
      req.viewer,
      candidate,
      config,
      req.now,
    );
    eligible.push({ candidate, breakdown });
  }

  eligible.sort((a, b) => b.breakdown.total - a.breakdown.total);

  const diversified = applyFairnessAndDiversityRules(eligible).slice(
    0,
    req.limit,
  );

  return {
    algorithmVersion: config.algorithmVersion,
    rankingConfigVersion: config.rankingConfigVersion,
    deckSessionId: req.deckSessionId,
    cards: diversified.map(({ candidate, breakdown }) => ({
      profileId: candidate.profile.id,
      userId: candidate.profile.userId,
      score: breakdown.total,
      explanation: explain(req.viewer, candidate, config),
    })),
  };
}
