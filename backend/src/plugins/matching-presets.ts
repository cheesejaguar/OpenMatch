import fp from "fastify-plugin";
import {
  getPresetCatalog,
  invalidatePresetCatalog,
  type PresetCatalog,
} from "../lib/matching-presets.js";

// Matching-preset plugin. Decorates the Fastify instance with
// `app.matchingPresets` so the discovery service and admin routes can read /
// invalidate the cached catalog without importing the lib directly.

declare module "fastify" {
  interface FastifyInstance {
    matchingPresets: {
      catalog: () => Promise<PresetCatalog>;
      invalidate: () => void;
    };
  }
}

export default fp(async (app) => {
  app.decorate("matchingPresets", {
    catalog: () => getPresetCatalog(app.prisma),
    invalidate: () => invalidatePresetCatalog(),
  });

  // Best-effort prime; never blocks startup. Mirrors the flags plugin.
  app.addHook("onReady", async () => {
    try {
      await getPresetCatalog(app.prisma);
    } catch (err) {
      app.log.warn({ err }, "matching_presets_prime_failed");
    }
  });
});
