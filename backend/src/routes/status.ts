import type { FastifyPluginAsync } from "fastify";

import { buildPublicStatus } from "../services/status.service.js";

// Public status page data. Unauthenticated — anyone can call this and
// the response is intended for visitors checking platform health.
//
// We cache the snapshot for 15 s so a refresh-storm on a popular
// outage doesn't hammer the synthetic + incident tables.
const PUBLIC_STATUS_CACHE_MS = 15_000;

let cachedSnapshot: {
  snapshot: Awaited<ReturnType<typeof buildPublicStatus>>;
  expiresAt: number;
} | null = null;

export const statusRoutes: FastifyPluginAsync = async (app) => {
  app.get("/public", async (_req, reply) => {
    const now = Date.now();
    if (cachedSnapshot && cachedSnapshot.expiresAt > now) {
      // Tag the response so a downstream CDN / Vercel edge can shorten
      // its hit ratio. The Cache-Control max-age intentionally matches
      // the in-memory TTL so a CDN never serves stale data.
      reply.header("Cache-Control", "public, max-age=15, s-maxage=15");
      return reply.send(cachedSnapshot.snapshot);
    }
    const snapshot = await buildPublicStatus(app);
    cachedSnapshot = { snapshot, expiresAt: now + PUBLIC_STATUS_CACHE_MS };
    reply.header("Cache-Control", "public, max-age=15, s-maxage=15");
    return reply.send(snapshot);
  });
};

// Test-only hook so a spec can force the next call to re-aggregate.
export function _resetStatusCacheForTests(): void {
  cachedSnapshot = null;
}
