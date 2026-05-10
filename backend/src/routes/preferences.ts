import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const updatePrefs = z.object({
  minAge: z.number().int().min(18).max(120).optional(),
  maxAge: z.number().int().min(18).max(120).optional(),
  maxDistanceKm: z.number().int().min(1).max(20000).optional(),
  interestedGenders: z.array(z.string()).optional(),
  relationshipGoals: z.array(z.string()).optional(),
  heightMinCm: z.number().int().min(120).max(230).optional(),
  heightMaxCm: z.number().int().min(120).max(230).optional(),
  educationLevels: z.array(z.string()).optional(),
  colleges: z.array(z.string()).optional(),
  lifestyleFilters: z.record(z.unknown()).optional(),
  includeUnansweredOptionalFields: z.boolean().optional(),
  hardFilters: z.record(z.unknown()).optional(),
  softPreferences: z.record(z.unknown()).optional(),
  excludeIncompatibleGoals: z.boolean().optional(),
  likesVisibility: z.enum(["visible", "count_only", "hidden"]).optional(),
  discoveryPaused: z.boolean().optional(),
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
        return reply.code(400).send({ error: "min_age_above_max" });
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
