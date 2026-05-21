import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { haversineKm } from "../lib/location.js";
import { getActiveMetros } from "../lib/metros-cache.js";

// Metro / city geo-fence.
//
// For the beta we restrict signups and profile updates to candidates
// who fall inside one of the active MetroBoundary rows for their
// inferred country. The check is intentionally permissive when:
//   - no coords were declared (e.g. dev tooling / older clients), or
//   - no metro is configured for the country yet
// so existing flows / screenshot scripts keep working.
//
// Discovery has its own filter (see services/discovery.service.ts);
// this plugin only gates the write path.

declare module "fastify" {
  interface FastifyInstance {
    checkMetro: (
      req: FastifyRequest,
      input?: {
        countryCode?: string | null;
        location?: { lat: number; lng: number } | null;
      },
    ) => Promise<MetroDecision>;
  }
}

export type MetroDecision =
  | { allow: true }
  | { allow: false; reason: "outside_metro"; nearestKm?: number; metro?: string };

function header(req: FastifyRequest, name: string): string | null {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0]!;
  return null;
}

export default fp(async (app) => {
  app.decorate(
    "checkMetro",
    async (
      req: FastifyRequest,
      input?: {
        countryCode?: string | null;
        location?: { lat: number; lng: number } | null;
      },
    ): Promise<MetroDecision> => {
      const location = input?.location ?? null;
      // No declared location: fall back to country gate (allow). Older
      // clients and dev scripts won't carry coords.
      if (!location) return { allow: true };

      const country =
        input?.countryCode ?? app.inferCountry(req) ?? header(req, "x-openmatch-country") ?? null;
      // No country known: can't pick which metros apply. Allow.
      if (!country) return { allow: true };

      // PERF-B12 — route through the in-process LRU keyed by country.
      const metros = await getActiveMetros(app.prisma, country);
      if (metros.length === 0) {
        // Back-compat: country is launch-supported but no metro defined
        // yet — let the country gate be the only gate.
        return { allow: true };
      }
      let nearest = Number.POSITIVE_INFINITY;
      let nearestSlug: string | undefined;
      for (const m of metros) {
        const distKm = haversineKm(location, { lat: m.centerLat, lng: m.centerLng });
        if (distKm <= m.radiusKm) return { allow: true };
        if (distKm < nearest) {
          nearest = distKm;
          nearestSlug = m.slug;
        }
      }
      return { allow: false, reason: "outside_metro", nearestKm: nearest, metro: nearestSlug };
    },
  );
});
