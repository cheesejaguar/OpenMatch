import type { AlgorithmStrategy } from "../types.js";
import { reciprocalStrategy } from "./reciprocal.js";
import { weightedSumStrategy } from "./weightedSum.js";

// The default strategy used when a deck request names no strategy, or names
// one that is not registered. Kept as a constant so callers can reference it.
export const DEFAULT_STRATEGY_ID = weightedSumStrategy.id;

const REGISTRY = new Map<string, AlgorithmStrategy>();

// Registers (or replaces) a strategy by id. Designed so a future learned
// ranker can register itself at module load without touching the deck
// assembler or any caller.
export function registerStrategy(strategy: AlgorithmStrategy): void {
  REGISTRY.set(strategy.id, strategy);
}

// Returns the strategy for `id`, falling back to the default when `id` is
// undefined or unknown. Never throws — an unknown id must not break a deck.
export function getStrategy(id?: string): AlgorithmStrategy {
  if (id) {
    const found = REGISTRY.get(id);
    if (found) return found;
  }
  return REGISTRY.get(DEFAULT_STRATEGY_ID) as AlgorithmStrategy;
}

// Lists every registered strategy (id/label/description) for transparency
// surfaces and admin UIs. Stable order: default first, then insertion order.
export function listStrategies(): AlgorithmStrategy[] {
  return [...REGISTRY.values()];
}

export function hasStrategy(id: string): boolean {
  return REGISTRY.has(id);
}

// Built-ins. Order matters for listStrategies() — default first.
registerStrategy(weightedSumStrategy);
registerStrategy(reciprocalStrategy);
