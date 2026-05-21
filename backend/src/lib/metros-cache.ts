import type { MetroBoundary, PrismaClient } from "@prisma/client";

// PERF-B12 — Tiny in-process LRU for active MetroBoundary rows. The two
// hot paths that touch this table — `plugins/metro-gate.ts:checkMetro`
// (signup + profile edit) and `services/discovery.service.ts:buildDeck`
// — both run on every request and previously did a fresh `findMany` per
// call. Metro rows change at most quarterly, so even a 30s TTL eliminates
// >95% of the round-trips on those paths.
//
// Cache is keyed by `(active, countryCode)` since that's the predicate
// `metro-gate` filters on. `discovery.service.ts` filters by `active:
// true` only — we route that through a separate `__ALL__` country key.
// Admin write paths in `routes/admin/metros.ts` call `invalidateMetros()`
// on success so a new row propagates immediately rather than waiting on
// TTL expiry.

interface Entry {
  rows: MetroBoundary[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
let ttlMs = DEFAULT_TTL_MS;
const cache = new Map<string, Entry>();

export function __setMetrosCacheTtlMs(ms: number): void {
  ttlMs = ms;
}

export function invalidateMetros(): void {
  cache.clear();
}

function key(countryCode: string | null): string {
  return countryCode === null ? "__ALL__" : countryCode.toUpperCase();
}

export async function getActiveMetros(
  prisma: PrismaClient,
  countryCode: string | null,
): Promise<MetroBoundary[]> {
  const now = Date.now();
  const k = key(countryCode);
  const cached = cache.get(k);
  if (cached && cached.expiresAt > now) return cached.rows;

  const where =
    countryCode === null
      ? ({ active: true } as const)
      : ({ active: true, countryCode: countryCode.toUpperCase() } as const);
  const rows = await prisma.metroBoundary.findMany({ where });
  cache.set(k, { rows, expiresAt: now + ttlMs });
  return rows;
}
