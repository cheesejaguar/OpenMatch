import type { FastifyPluginAsync } from "fastify";
import {
  COACHING_TIPS,
  CONTENT_VERSION,
  DEALBREAKERS_CATALOG,
  PROMPT_CATALOG,
  QUESTION_SETS,
  VALUES_CATALOG,
} from "../lib/content/catalogs.js";

// Read-only content catalogs (values, curated prompts, escalating question
// sets, coaching tips). Single source of truth for the iOS client. Auth-gated
// like the rest of the app; safe to cache privately for a while since the
// catalogs are code-defined and only change on deploy.
export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/catalogs", async (_req, reply) => {
    reply.header("cache-control", "private, max-age=3600");
    return {
      version: CONTENT_VERSION,
      values: VALUES_CATALOG,
      dealbreakers: DEALBREAKERS_CATALOG,
      prompts: PROMPT_CATALOG,
      questionSets: QUESTION_SETS,
      coachingTips: COACHING_TIPS,
    };
  });
};
