// Example RankingProvider — pure shuffle.
//
// This file documents the contract a fork must satisfy to ship a custom
// ranker. It is NOT a recommended production implementation: the deck
// it produces ignores every signal (distance, activity, fairness, …).
// It exists so a reader can see the smallest valid impl in one screen
// and copy it as a starting point.
//
// Usage from a fork's bootstrap code (e.g. before buildServer() in
// `backend/src/server.ts`, behind an opt-in env var):
//
//   import { RandomRankingProvider } from "../examples/providers/random-ranking-provider.js";
//   RankingProviderRegistry.register(new RandomRankingProvider());
//   // operator then sets RANKING_PROVIDER=random in the environment.

import type { RankedCandidate, RankInput, RankingProvider } from "@openmatch/matching";
import { currentConfig, explain } from "@openmatch/matching";

export class RandomRankingProvider implements RankingProvider {
  readonly name = "random";

  async rank(input: RankInput): Promise<RankedCandidate[]> {
    // Fisher-Yates shuffle on a copy of the candidate list so the
    // caller's array is not mutated. We don't seed the RNG — this is a
    // demonstration provider; a real implementation might seed from
    // (viewerId, deckSessionId) for reproducible decks.
    const shuffled = [...input.candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    const limit = input.limit ?? shuffled.length;
    return shuffled.slice(0, limit).map((c, idx) => ({
      profileId: c.profile.id,
      userId: c.profile.userId,
      // Synthetic descending score so downstream consumers that expect
      // `score` to be sorted still see a sane ordering signal.
      score: 1 - idx / Math.max(shuffled.length, 1),
      // Reuse the builtin `explain` so the iOS card UI keeps rendering
      // the same explanation pills. Forks with bespoke explanations
      // can build their own Explanation shape here.
      explanation: explain(input.viewer, c, currentConfig),
    }));
  }
}
