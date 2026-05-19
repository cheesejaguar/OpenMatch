import type { PrismaClient } from "@prisma/client";

// Feature-flag evaluator.
//
// Lookups go through a small in-process cache with a short TTL so the
// hot path doesn't hit Postgres on every request. The variants column is
// stored but not yet consulted — cohort-targeting is a follow-on pass
// (see docs/launch/REPORT_CARD.md OPS-2). Missing flags default to
// `false`; a flag that doesn't exist is the safe (off) state.

export interface FlagEvaluationContext {
  // Reserved for cohort-targeting once variants are evaluated.
  userId?: string | null;
  cohortLabel?: string | null;
}

interface CachedEntry {
  enabled: boolean;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;

let ttlMs = DEFAULT_TTL_MS;
const cache = new Map<string, CachedEntry>();

export function __setFlagsCacheTtlMs(ms: number): void {
  // Tests bypass / shorten the cache deliberately.
  ttlMs = ms;
}

export function __clearFlagsCache(): void {
  cache.clear();
}

export async function evaluateFlag(
  prisma: PrismaClient,
  key: string,
  _ctx?: FlagEvaluationContext,
): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.enabled;

  const row = await prisma.featureFlag.findUnique({ where: { key } });
  const enabled = row?.enabled ?? false;
  cache.set(key, { enabled, expiresAt: now + ttlMs });
  return enabled;
}

export async function primeFlagCache(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.featureFlag.findMany();
  const expiresAt = Date.now() + ttlMs;
  for (const r of rows) {
    cache.set(r.key, { enabled: r.enabled, expiresAt });
  }
}

export function invalidateFlag(key: string): void {
  cache.delete(key);
}
