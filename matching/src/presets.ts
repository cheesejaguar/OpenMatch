import { DEFAULT_STRATEGY_ID } from "./strategies/registry.js";
import type {
  AlgorithmConfig,
  RankingWeights,
  ResolveConfigOptions,
  WeightPreset,
} from "./types.js";
import { WEIGHT_KEYS } from "./types.js";

// Built-in, code-defined presets. The DB-backed admin catalog seeds from
// these; they are also the safe fallback when the catalog is empty. Each
// preset's `weights` is a partial overlay on the base config's weights.
//
// `balanced` intentionally carries no overrides so it resolves to whatever the
// shipped algorithm_config.json declares — it is the source-of-truth default.
export const BUILTIN_PRESETS: WeightPreset[] = [
  {
    key: "balanced",
    label: "Balanced",
    description: "Our default blend — a little of everything.",
    strategyId: DEFAULT_STRATEGY_ID,
    weights: {},
  },
  {
    key: "nearby-first",
    label: "Nearby first",
    description: "Prioritizes people close to you.",
    strategyId: DEFAULT_STRATEGY_ID,
    weights: { distance: 0.45, activity: 0.1, sharedInterests: 0.08, ageProximity: 0.05 },
  },
  {
    key: "fresh-faces",
    label: "Fresh faces",
    description: "Surfaces recently active profiles and people you haven't seen.",
    strategyId: DEFAULT_STRATEGY_ID,
    weights: { activity: 0.32, fairnessRotation: 0.15, randomization: 0.08, distance: 0.1 },
  },
  {
    key: "serious-intent",
    label: "Serious intent",
    description: "Emphasizes relationship-goal compatibility and mutual fit.",
    strategyId: "reciprocal",
    weights: { relationshipGoal: 0.3, reciprocity: 0.22, sharedInterests: 0.18, randomization: 0 },
  },
];

function zeroWeights(): RankingWeights {
  return {
    distance: 0,
    activity: 0,
    preferenceOverlap: 0,
    relationshipGoal: 0,
    profileCompleteness: 0,
    sharedInterests: 0,
    reciprocity: 0,
    ageProximity: 0,
    valuesOverlap: 0,
    desirabilityBalance: 0,
    responseLikelihood: 0,
    fairnessRotation: 0,
    randomization: 0,
  };
}

// Normalizes a weight map so its values sum to 1, keeping total scores
// comparable across presets and within [0,1]. A degenerate all-zero map is
// returned unchanged (callers should treat that as "no signal").
export function normalizeWeights(weights: RankingWeights): RankingWeights {
  let sum = 0;
  for (const k of WEIGHT_KEYS) sum += weights[k] ?? 0;
  if (sum <= 0) return { ...weights };
  const out = zeroWeights();
  for (const k of WEIGHT_KEYS) out[k] = (weights[k] ?? 0) / sum;
  return out;
}

function findPreset(key: string | undefined, presets: WeightPreset[]): WeightPreset | undefined {
  if (!key) return undefined;
  return presets.find((p) => p.key === key);
}

// Produces a frozen AlgorithmConfig from a base config plus selection options.
// Resolution order (later wins): base weights → preset overlay → ad-hoc
// weightOverrides. The result's weights are normalized to sum to 1. The
// strategy id is recorded on the config so the deck assembler can honor a
// preset that pins a specific strategy without a separate channel.
export function resolveConfig(
  base: AlgorithmConfig,
  options: ResolveConfigOptions = {},
): AlgorithmConfig {
  const presets = options.presets ?? BUILTIN_PRESETS;
  const preset = findPreset(options.presetKey, presets);

  const merged: RankingWeights = { ...zeroWeights(), ...base.weights };
  if (preset) Object.assign(merged, preset.weights);
  if (options.weightOverrides) Object.assign(merged, options.weightOverrides);

  const strategyId = options.strategyId ?? preset?.strategyId ?? DEFAULT_STRATEGY_ID;

  return Object.freeze({
    ...base,
    weights: Object.freeze(normalizeWeights(merged)),
    strategyId,
  });
}
