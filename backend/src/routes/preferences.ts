import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";

// SEV-V15 — every array field gets an explicit per-item cap AND a
// per-array cap consistent with profile.ts. Previously these were
// `z.array(z.string()).optional()` with no upper bound, so a
// malicious caller could submit a 50MB payload of 1KB strings; the
// Zod parse + Prisma reject still ran, costing wall-clock CPU on the
// Vercel function.
const updatePrefs = z.object({
  minAge: z.number().int().min(18).max(120).optional(),
  maxAge: z.number().int().min(18).max(120).optional(),
  maxDistanceKm: z.number().int().min(1).max(20000).optional(),
  interestedGenders: z.array(z.string().min(1).max(40)).max(20).optional(),
  relationshipGoals: z.array(z.string().min(1).max(40)).max(20).optional(),
  heightMinCm: z.number().int().min(120).max(230).optional(),
  heightMaxCm: z.number().int().min(120).max(230).optional(),
  educationLevels: z.array(z.string().min(1).max(60)).max(20).optional(),
  colleges: z.array(z.string().min(1).max(120)).max(20).optional(),
  lifestyleFilters: z.record(z.string(), z.unknown()).optional(),
  includeUnansweredOptionalFields: z.boolean().optional(),
  hardFilters: z.record(z.string(), z.unknown()).optional(),
  softPreferences: z.record(z.string(), z.unknown()).optional(),
  excludeIncompatibleGoals: z.boolean().optional(),
  likesVisibility: z.enum(["visible", "count_only", "hidden"]).optional(),
  discoveryPaused: z.boolean().optional(),
  handedness: z.enum(["right", "left", "center"]).optional(),
});

export const preferencesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/me", async (req) => {
    const prefs = await app.prisma.preferences.upsert({
      where: { userId: req.userId! },
      create: { userId: req.userId! },
      update: {},
    });
    return prefs;
  });

  app.patch("/me", async (req, reply) => {
    const body = updatePrefs.parse(req.body);
    if (body.minAge !== undefined && body.maxAge !== undefined) {
      if (body.minAge > body.maxAge) {
        return sendHttpError(reply, httpError(ErrorCodes.MIN_AGE_ABOVE_MAX));
      }
    }
    const prefs = await app.prisma.preferences.upsert({
      where: { userId: req.userId! },
      create: { userId: req.userId!, ...(body as Record<string, unknown>) } as never,
      update: body as never,
    });
    return prefs;
  });
};
