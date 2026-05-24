import { hasStrategy, WEIGHT_KEYS } from "@openmatch/matching";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { ErrorCodes } from "../../lib/error-codes.js";
import { httpError, sendHttpError } from "../../lib/http-error.js";

// Admin CRUD for the matching-preset catalog. End-users select a preset via
// their preferences; admins curate which presets exist, their weights, and
// which is the default. Mutations invalidate the in-memory catalog cache on
// the originating instance; other instances refresh within the 30s TTL.
//
// Weights are stored as a partial RankingWeights overlay and normalized to
// sum to 1 by the matching package at resolve time, so admin input need not
// pre-normalize — only stay within [0, 1] per key.

const WEIGHT_KEY_SET = new Set<string>(WEIGHT_KEYS);

const weightsSchema = z
  .record(z.string(), z.number().min(0).max(1))
  .refine((w) => Object.keys(w).every((k) => WEIGHT_KEY_SET.has(k)), {
    message: "unknown_weight_key",
  });

const strategyIdSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((id) => hasStrategy(id), { message: "unknown_strategy" });

const keySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/, "key_must_be_kebab_case");

const upsertSchema = z.object({
  key: keySchema,
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(280),
  strategyId: strategyIdSchema,
  weights: weightsSchema,
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const patchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(280).optional(),
  strategyId: strategyIdSchema.optional(),
  weights: weightsSchema.optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

function serialize(p: {
  id: string;
  key: string;
  label: string;
  description: string;
  strategyId: string;
  weights: unknown;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  updatedAt: Date;
  updatedByAdminUserId: string | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    key: p.key,
    label: p.label,
    description: p.description,
    strategyId: p.strategyId,
    weights: p.weights,
    enabled: p.enabled,
    isDefault: p.isDefault,
    sortOrder: p.sortOrder,
    updatedAt: p.updatedAt.toISOString(),
    updatedByAdminUserId: p.updatedByAdminUserId,
    createdAt: p.createdAt.toISOString(),
  };
}

export const adminMatchingPresetsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.MATCHING_PRESET_MANAGE));

  app.get("/", async (_req, reply) => {
    const rows = await app.prisma.matchingPreset.findMany({ orderBy: { sortOrder: "asc" } });
    return reply.send({ items: rows.map(serialize) });
  });

  app.post("/", async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    const principal = req.admin!;
    const existing = await app.prisma.matchingPreset.findUnique({ where: { key: body.key } });

    const data = {
      label: body.label,
      description: body.description,
      strategyId: body.strategyId,
      weights: body.weights as Prisma.InputJsonValue,
      enabled: body.enabled,
      isDefault: body.isDefault,
      sortOrder: body.sortOrder,
      updatedByAdminUserId: principal.adminUserId,
    };

    // If this preset becomes the default, demote every other preset in the
    // same transaction so exactly one default exists.
    const row = await app.prisma.$transaction(async (tx) => {
      const saved = await tx.matchingPreset.upsert({
        where: { key: body.key },
        create: { key: body.key, ...data },
        update: data,
      });
      if (body.isDefault) {
        await tx.matchingPreset.updateMany({
          where: { key: { not: body.key } },
          data: { isDefault: false },
        });
      }
      return saved;
    });

    app.matchingPresets.invalidate();
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: existing ? "matching_preset_updated" : "matching_preset_created",
        targetEntityType: "matching_preset",
        targetEntityId: row.id,
        metadata: {
          key: body.key,
          before: existing
            ? {
                strategyId: existing.strategyId,
                weights: existing.weights as Prisma.InputJsonValue,
                enabled: existing.enabled,
                isDefault: existing.isDefault,
              }
            : null,
          after: {
            strategyId: body.strategyId,
            weights: body.weights as Prisma.InputJsonValue,
            enabled: body.enabled,
            isDefault: body.isDefault,
          },
        },
      },
    );
    return reply.send(serialize(row));
  });

  app.patch<{ Params: { key: string } }>("/:key", async (req, reply) => {
    const body = patchSchema.parse(req.body);
    const principal = req.admin!;
    const existing = await app.prisma.matchingPreset.findUnique({
      where: { key: req.params.key },
    });
    if (!existing) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));

    const data: Prisma.MatchingPresetUpdateInput = {
      ...(body.label !== undefined && { label: body.label }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.strategyId !== undefined && { strategyId: body.strategyId }),
      ...(body.weights !== undefined && { weights: body.weights as Prisma.InputJsonValue }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      updatedByAdminUserId: principal.adminUserId,
    };

    const updated = await app.prisma.$transaction(async (tx) => {
      const saved = await tx.matchingPreset.update({ where: { key: req.params.key }, data });
      if (body.isDefault === true) {
        await tx.matchingPreset.updateMany({
          where: { key: { not: req.params.key } },
          data: { isDefault: false },
        });
      }
      return saved;
    });

    app.matchingPresets.invalidate();
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "matching_preset_updated",
        targetEntityType: "matching_preset",
        targetEntityId: updated.id,
        metadata: {
          key: req.params.key,
          before: {
            strategyId: existing.strategyId,
            weights: existing.weights as Prisma.InputJsonValue,
            enabled: existing.enabled,
            isDefault: existing.isDefault,
          },
          after: {
            strategyId: updated.strategyId,
            weights: updated.weights as Prisma.InputJsonValue,
            enabled: updated.enabled,
            isDefault: updated.isDefault,
          },
        },
      },
    );
    return reply.send(serialize(updated));
  });
};
