import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { decideCountry } from "../lib/safety/country-policy.js";

// Country-gate plugin.
//
// Decorates the Fastify app with `checkCountry(req)`, used by signup
// and the public DSA notice intake to refuse traffic from blocked
// jurisdictions. Logs a SanctionsScreening record on every decision.
//
// Country source priority:
//   1. Vercel's `x-vercel-ip-country` header (set on the edge).
//   2. Standard `cf-ipcountry` (when behind Cloudflare).
//   3. A manual `x-openmatch-country` header (tests; never trust in
//      production unless from a known load balancer).
//
// IP-geolocation is best-effort, not legally definitive. The actual
// gate is at signup, where the user also self-declares country; both
// signals are checked and the *stricter* result wins.

declare module "fastify" {
  interface FastifyInstance {
    checkCountry: (
      req: FastifyRequest,
      declaredCountry?: string | null,
    ) => ReturnType<typeof decideCountry>;
    inferCountry: (req: FastifyRequest) => string | null;
  }
}

function header(req: FastifyRequest, name: string): string | null {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0]!;
  return null;
}

export default fp(async (app) => {
  app.decorate("inferCountry", (req: FastifyRequest): string | null => {
    return (
      header(req, "x-vercel-ip-country") ??
      header(req, "cf-ipcountry") ??
      header(req, "x-openmatch-country")
    );
  });

  app.decorate("checkCountry", (req: FastifyRequest, declaredCountry?: string | null) => {
    const inferred = app.inferCountry(req);
    const inferredDecision = decideCountry(inferred);
    if (!declaredCountry) return inferredDecision;
    const declaredDecision = decideCountry(declaredCountry);
    // Stricter wins: any block beats any allow.
    if (!inferredDecision.allow) return inferredDecision;
    if (!declaredDecision.allow) return declaredDecision;
    return { allow: true } as const;
  });
});
