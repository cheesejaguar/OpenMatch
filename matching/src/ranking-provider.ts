// RankingProvider — fork-extension surface for the deck-ranking step.
//
// The default `BuiltinRankingProvider` wraps the existing rules-based
// `getDiscoveryDeck()` so behaviour is unchanged when a deployment ships
// without a custom provider. A fork that wants to swap in (e.g.) an
// ML-ranked deck implements this interface, registers the instance via
// `RankingProviderRegistry.register(...)` at boot, and selects it with
// the `RANKING_PROVIDER` env var (read by the backend, see
// `backend/src/plugins/ranking.ts`).
//
// The interface is intentionally tighter than `DeckRequest`: a custom
// implementation receives only the inputs it needs to rank a candidate
// list (viewer, candidates, config version metadata) and returns a
// ranked list with score + explanation. Eligibility filtering, the
// blocks list, and prior-swipes filtering remain the caller's
// responsibility so the surface area a fork has to think about stays
// small. Forks that want to override eligibility can layer a second
// provider on top of the built-in one.

import { currentConfig } from "./config.js";
import { getDiscoveryDeck } from "./deck.js";
import { explain } from "./explain.js";
import { scoreCandidate } from "./scoring.js";
import type {
  Block,
  Candidate,
  DeckRequest,
  DeckResponse,
  Explanation,
  PriorSwipe,
  ProfileId,
  UserId,
  Viewer,
} from "./types.js";

export interface RankedCandidate {
  profileId: ProfileId;
  userId: UserId;
  score: number;
  explanation: Explanation;
}

export interface RankInput {
  viewer: Viewer;
  candidates: Candidate[];
  config: { algorithmVersion: string; rankingConfigVersion: string };
  // Optional context the built-in ranker uses but custom rankers may
  // ignore. Forks that don't need them can skip these fields.
  blocks?: Block[];
  priorSwipes?: PriorSwipe[];
  now?: Date;
  limit?: number;
  deckSessionId?: string;
}

export interface RankingProvider {
  /**
   * Stable identifier used in logs and admin diagnostics. The built-in
   * provider returns "builtin"; custom forks should return something
   * descriptive like "ml-v3" so the dashboard can show which ranker
   * produced each deck.
   */
  readonly name: string;
  rank(input: RankInput): Promise<RankedCandidate[]>;
}

// -------- Builtin --------------------------------------------------------

export class BuiltinRankingProvider implements RankingProvider {
  readonly name = "builtin";

  async rank(input: RankInput): Promise<RankedCandidate[]> {
    // Re-use the existing rules engine end-to-end. We accept partial
    // DeckRequest fields and supply benign defaults for the bits a thin
    // caller might not pass in (`blocks`, `priorSwipes`, `now`,
    // `limit`, `deckSessionId`). The backend's `discovery.service.ts`
    // always passes all of these, so this branch only matters for
    // synthetic / contract-test callers.
    const req: DeckRequest = {
      viewer: input.viewer,
      candidates: input.candidates,
      blocks: input.blocks ?? [],
      priorSwipes: input.priorSwipes ?? [],
      now: input.now ?? new Date(),
      limit: input.limit ?? input.candidates.length,
      deckSessionId: input.deckSessionId ?? "ranker-direct",
      config: currentConfig,
    };
    const deck: DeckResponse = getDiscoveryDeck(req);
    return deck.cards.map((c) => ({
      profileId: c.profileId,
      userId: c.userId,
      score: c.score,
      explanation: c.explanation,
    }));
  }
}

// -------- Registry ------------------------------------------------------

class Registry {
  private byName = new Map<string, RankingProvider>();
  private defaultName = "builtin";

  constructor() {
    this.register(new BuiltinRankingProvider());
  }

  register(impl: RankingProvider): void {
    this.byName.set(impl.name, impl);
  }

  setDefault(name: string): void {
    if (!this.byName.has(name)) {
      throw new Error(`RankingProvider "${name}" is not registered`);
    }
    this.defaultName = name;
  }

  /**
   * Resolve a provider by name. Falls back to the registry's current
   * default when `name` is undefined or unknown. The fallback path
   * preserves the previous behaviour when an operator sets
   * `RANKING_PROVIDER=foo` before the fork that registers `foo` has
   * shipped — the deployment continues to serve the built-in ranker
   * rather than 5xx on every discovery call.
   */
  resolve(name?: string): RankingProvider {
    if (name && this.byName.has(name)) return this.byName.get(name)!;
    return this.byName.get(this.defaultName)!;
  }

  /** For tests — drops every registration except the built-in default. */
  reset(): void {
    this.byName.clear();
    this.defaultName = "builtin";
    this.register(new BuiltinRankingProvider());
  }
}

export const RankingProviderRegistry = new Registry();

// Helper for callers that want the score breakdown when implementing a
// custom provider. Re-exported so `examples/providers/*` don't need to
// reach into deep paths inside `@openmatch/matching`.
export { explain, scoreCandidate };
