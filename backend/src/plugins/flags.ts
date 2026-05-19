import fp from "fastify-plugin";
import {
  evaluateFlag,
  type FlagEvaluationContext,
  invalidateFlag,
  primeFlagCache,
} from "../lib/flags.js";

// Feature-flag plugin. Decorates the Fastify instance with `app.flags`
// so route handlers can `await app.flags.evaluate("invite_required")`
// without importing the lib directly. Primes the cache on boot so the
// first request after deploy doesn't pay the DB round-trip.

declare module "fastify" {
  interface FastifyInstance {
    flags: {
      evaluate: (key: string, ctx?: FlagEvaluationContext) => Promise<boolean>;
      invalidate: (key: string) => void;
    };
  }
}

export default fp(async (app) => {
  app.decorate("flags", {
    evaluate: (key: string, ctx?: FlagEvaluationContext) => evaluateFlag(app.prisma, key, ctx),
    invalidate: (key: string) => invalidateFlag(key),
  });

  // Best-effort cache prime; never blocks startup. If the table doesn't
  // exist yet (mid-migration), we silently skip — the first eval will
  // populate the cache.
  app.addHook("onReady", async () => {
    try {
      await primeFlagCache(app.prisma);
    } catch (err) {
      app.log.warn({ err }, "flags_prime_failed");
    }
  });
});
