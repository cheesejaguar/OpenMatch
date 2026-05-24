import { BUILTIN_PRESETS, type RankingWeights, type WeightPreset } from "@openmatch/matching";
import type { PrismaClient } from "@prisma/client";

// Matching-preset catalog cache.
//
// The discovery hot path resolves every viewer's selected preset on each deck
// build, so the admin-curated catalog is read through a short-TTL in-process
// cache (same shape as lib/flags.ts). Only enabled presets are exposed.
// If the table is empty or unreachable we fall back to the code-defined
// BUILTIN_PRESETS so discovery never breaks mid-migration.

export interface PresetCatalog {
  presets: WeightPreset[];
  defaultKey: string;
}

interface CachedCatalog extends PresetCatalog {
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
let ttlMs = DEFAULT_TTL_MS;
let cache: CachedCatalog | null = null;

export function __setMatchingPresetsCacheTtlMs(ms: number): void {
  ttlMs = ms;
}

export function __clearMatchingPresetsCache(): void {
  cache = null;
}

const FALLBACK: PresetCatalog = {
  presets: BUILTIN_PRESETS,
  defaultKey: "balanced",
};

export async function getPresetCatalog(prisma: PrismaClient): Promise<PresetCatalog> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { presets: cache.presets, defaultKey: cache.defaultKey };
  }
  let catalog: PresetCatalog;
  try {
    const rows = await prisma.matchingPreset.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    });
    if (rows.length === 0) {
      catalog = FALLBACK;
    } else {
      const presets: WeightPreset[] = rows.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        strategyId: r.strategyId,
        weights: (r.weights ?? {}) as Partial<RankingWeights>,
      }));
      const defaultRow = rows.find((r) => r.isDefault) ?? rows[0]!;
      catalog = { presets, defaultKey: defaultRow.key };
    }
  } catch {
    catalog = FALLBACK;
  }
  cache = { ...catalog, expiresAt: now + ttlMs };
  return catalog;
}

// Resolves the effective preset key for a viewer: their selection if it is a
// currently-enabled preset, otherwise the catalog default.
export function resolveActivePresetKey(catalog: PresetCatalog, selected: string | null): string {
  if (selected && catalog.presets.some((p) => p.key === selected)) return selected;
  return catalog.defaultKey;
}

export function invalidatePresetCatalog(): void {
  cache = null;
}
