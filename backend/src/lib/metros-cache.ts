import type { MetroBoundary, PrismaClient } from "@prisma/client";
import { AsyncCache } from "./async-cache.js";

const DEFAULT_TTL_MS = 30_000;
let ttlMs = DEFAULT_TTL_MS;
// Scope by client so tests, tenants, and independently configured apps cannot
// reuse another database's rows. Resetting the map fences in-flight loads.
let caches = new WeakMap<PrismaClient, AsyncCache<string, MetroBoundary[]>>();

export function __setMetrosCacheTtlMs(ms: number): void {
  ttlMs = ms;
  invalidateMetros();
}

export function invalidateMetros(): void {
  caches = new WeakMap();
}

export function getActiveMetros(
  prisma: PrismaClient,
  countryCode: string | null,
): Promise<MetroBoundary[]> {
  let cache = caches.get(prisma);
  if (!cache) {
    cache = new AsyncCache(ttlMs);
    caches.set(prisma, cache);
  }
  const country = countryCode?.toUpperCase() ?? null;
  return cache.get(country ?? "__ALL__", () =>
    prisma.metroBoundary.findMany({
      where: { active: true, ...(country === null ? {} : { countryCode: country }) },
    }),
  );
}
