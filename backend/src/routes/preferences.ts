import type { Prisma } from "@prisma/client";
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
    // SEV-V1 — explicit allow-list. The previous `...(body as
    // Record<string, unknown>)` / `update: body as never` cast escaped
    // the Prisma type system and made every Zod-known field
    // user-writable. Re-listing each field as a typed
    // PreferencesUpdateInput re-introduces compile-time gating: a
    // future column that lands on the Preferences model AND is added
    // to the Zod schema by mistake will require a deliberate addition
    // here before it becomes user-writable.
    //
    // Type assertions: the `interestedGenders` / `relationshipGoals`
    // arrays accept `string[]` from the Zod parse but are typed as
    // Prisma enum arrays. The Prisma client validates them at query
    // time; the cast is the same invariant we'd need with any string-
    // typed enum field.
    const updateData: Prisma.PreferencesUpdateInput = {
      ...(body.minAge !== undefined && { minAge: body.minAge }),
      ...(body.maxAge !== undefined && { maxAge: body.maxAge }),
      ...(body.maxDistanceKm !== undefined && { maxDistanceKm: body.maxDistanceKm }),
      ...(body.interestedGenders !== undefined && {
        interestedGenders: body.interestedGenders as never,
      }),
      ...(body.relationshipGoals !== undefined && {
        relationshipGoals: body.relationshipGoals as never,
      }),
      ...(body.heightMinCm !== undefined && { heightMinCm: body.heightMinCm }),
      ...(body.heightMaxCm !== undefined && { heightMaxCm: body.heightMaxCm }),
      ...(body.educationLevels !== undefined && { educationLevels: body.educationLevels }),
      ...(body.colleges !== undefined && { colleges: body.colleges }),
      ...(body.lifestyleFilters !== undefined && {
        lifestyleFilters: body.lifestyleFilters as never,
      }),
      ...(body.includeUnansweredOptionalFields !== undefined && {
        includeUnansweredOptionalFields: body.includeUnansweredOptionalFields,
      }),
      ...(body.hardFilters !== undefined && { hardFilters: body.hardFilters as never }),
      ...(body.softPreferences !== undefined && {
        softPreferences: body.softPreferences as never,
      }),
      ...(body.excludeIncompatibleGoals !== undefined && {
        excludeIncompatibleGoals: body.excludeIncompatibleGoals,
      }),
      ...(body.likesVisibility !== undefined && { likesVisibility: body.likesVisibility }),
      ...(body.discoveryPaused !== undefined && { discoveryPaused: body.discoveryPaused }),
      ...(body.handedness !== undefined && { handedness: body.handedness }),
    };
    const prefs = await app.prisma.preferences.upsert({
      where: { userId: req.userId! },
      create: { userId: req.userId!, ...updateData } as Prisma.PreferencesCreateInput,
      update: updateData,
    });
    return prefs;
  });
};
