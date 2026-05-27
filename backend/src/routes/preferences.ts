import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../lib/config.js";
import { DEALBREAKER_KEYS } from "../lib/content/catalogs.js";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";

// PERF-B16 / PERF-X4 — response schema for GET /preferences/me. Mirrors
// the Preferences Prisma model exactly. JSON-typed columns
// (lifestyleFilters, hardFilters, softPreferences) stay `unknown` since
// their schema is feature-flag driven; the rest is the full row.
const preferencesResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  minAge: z.number().int(),
  maxAge: z.number().int(),
  maxDistanceKm: z.number().int(),
  interestedGenders: z.array(z.string()),
  relationshipGoals: z.array(z.string()),
  heightMinCm: z.number().int().nullable(),
  heightMaxCm: z.number().int().nullable(),
  educationLevels: z.array(z.string()),
  colleges: z.array(z.string()),
  lifestyleFilters: z.unknown().nullable(),
  includeUnansweredOptionalFields: z.boolean(),
  hardFilters: z.unknown().nullable(),
  softPreferences: z.unknown().nullable(),
  excludeIncompatibleGoals: z.boolean(),
  likesVisibility: z.enum(["visible", "count_only", "hidden"]),
  discoveryPaused: z.boolean(),
  handedness: z.enum(["right", "left", "center"]),
  discoveryPresetKey: z.string().nullable(),
  verifiedOnly: z.boolean(),
  focusMode: z.boolean(),
  dealbreakers: z.array(z.string()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

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
  // null clears the selection (revert to the catalog default). A non-null
  // value is validated against the enabled preset catalog below.
  discoveryPresetKey: z.string().min(1).max(80).nullable().optional(),
  verifiedOnly: z.boolean().optional(),
  focusMode: z.boolean().optional(),
  // Dealbreaker catalog keys (#5). Validated against the catalog below.
  dealbreakers: z.array(z.string().min(1).max(60)).max(10).optional(),
});

export const preferencesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/me", { schema: { response: { 200: preferencesResponseSchema } } }, async (req, reply) => {
    const prefs = await app.prisma.preferences.upsert({
      where: { userId: req.userId! },
      create: { userId: req.userId! },
      update: {},
    });
    // PERF — preferences are user-private and frequently mutated by
    // settings edits; force private caches to revalidate on every
    // request rather than serving stale rows.
    reply.header("cache-control", "private, max-age=0, must-revalidate");
    return prefs;
  });

  // Public list of selectable matching presets (enabled only). Powers the
  // discovery-style picker in the iOS app. Mirrors the cached catalog the
  // discovery deck uses, so what a user can pick is exactly what can apply.
  r.get(
    "/matching-presets",
    {
      schema: {
        response: {
          200: z.object({
            defaultKey: z.string(),
            presets: z.array(
              z.object({
                key: z.string(),
                label: z.string(),
                description: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (_req, reply) => {
      const catalog = await app.matchingPresets.catalog();
      reply.header("cache-control", "private, max-age=60");
      return {
        defaultKey: catalog.defaultKey,
        presets: catalog.presets.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
        })),
      };
    },
  );

  app.patch("/me", async (req, reply) => {
    const body = updatePrefs.parse(req.body);
    if (body.minAge !== undefined && body.maxAge !== undefined) {
      if (body.minAge > body.maxAge) {
        return sendHttpError(reply, httpError(ErrorCodes.MIN_AGE_ABOVE_MAX));
      }
    }
    // Platform-config gating. The dating variant requires a non-empty
    // `interestedGenders` array and a populated age window; the
    // mentorship / sports variants flip these flags off entirely. We
    // only reject when the caller is *explicitly* clearing a required
    // field — silent omission stays a partial update.
    if (
      config.features.requireGenderPreferences &&
      body.interestedGenders !== undefined &&
      body.interestedGenders.length === 0
    ) {
      return sendHttpError(reply, httpError(ErrorCodes.VALIDATION_FAILED));
    }
    if (config.features.requireAgeWindow) {
      if (
        (body.minAge !== undefined && body.minAge <= 0) ||
        (body.maxAge !== undefined && body.maxAge <= 0)
      ) {
        return sendHttpError(reply, httpError(ErrorCodes.VALIDATION_FAILED));
      }
    }
    // Validate a non-null preset selection against the enabled catalog so a
    // user can't pin a disabled or nonexistent preset. null is allowed (it
    // reverts to the default at deck-build time).
    if (body.discoveryPresetKey != null) {
      const catalog = await app.matchingPresets.catalog();
      if (!catalog.presets.some((p) => p.key === body.discoveryPresetKey)) {
        return sendHttpError(reply, httpError(ErrorCodes.INVALID_REQUEST));
      }
    }
    // Dealbreakers must be known catalog keys (#5).
    if (body.dealbreakers && !body.dealbreakers.every((k) => DEALBREAKER_KEYS.has(k))) {
      return sendHttpError(reply, httpError(ErrorCodes.VALIDATION_FAILED));
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
      ...(body.discoveryPresetKey !== undefined && {
        discoveryPresetKey: body.discoveryPresetKey,
      }),
      ...(body.verifiedOnly !== undefined && { verifiedOnly: body.verifiedOnly }),
      ...(body.focusMode !== undefined && { focusMode: body.focusMode }),
      ...(body.dealbreakers !== undefined && { dealbreakers: body.dealbreakers }),
    };
    const prefs = await app.prisma.preferences.upsert({
      where: { userId: req.userId! },
      create: { userId: req.userId!, ...updateData } as Prisma.PreferencesCreateInput,
      update: updateData,
    });
    return prefs;
  });
};
