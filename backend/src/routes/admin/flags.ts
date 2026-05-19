import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { ErrorCodes } from "../../lib/error-codes.js";
import { httpError, sendHttpError } from "../../lib/http-error.js";

// Admin CRUD for feature flags. Flips invalidate the in-memory
// evaluator cache for that key immediately on the originating instance;
// other instances pick up the change within 30 s via the cache TTL.

const upsertSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9_]*$/, "key_must_be_snake_case"),
  enabled: z.boolean(),
  description: z.string().min(1).max(500),
  variants: z.record(z.string(), z.unknown()).optional(),
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  description: z.string().min(1).max(500).optional(),
  variants: z.record(z.string(), z.unknown()).optional(),
});

export const adminFlagsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.FEATURE_FLAG_MANAGE));

  app.get("/", async (_req, reply) => {
    const rows = await app.prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    return reply.send({
      items: rows.map((f) => ({
        id: f.id,
        key: f.key,
        enabled: f.enabled,
        description: f.description,
        variants: f.variants,
        updatedAt: f.updatedAt.toISOString(),
        updatedByAdminUserId: f.updatedByAdminUserId,
        createdAt: f.createdAt.toISOString(),
      })),
    });
  });

  app.post("/", async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    const principal = req.admin!;
    const existing = await app.prisma.featureFlag.findUnique({ where: { key: body.key } });
    const row = await app.prisma.featureFlag.upsert({
      where: { key: body.key },
      create: {
        key: body.key,
        enabled: body.enabled,
        description: body.description,
        variants: (body.variants ?? undefined) as never,
        updatedByAdminUserId: principal.adminUserId,
      },
      update: {
        enabled: body.enabled,
        description: body.description,
        variants: (body.variants ?? undefined) as never,
        updatedByAdminUserId: principal.adminUserId,
      },
    });
    app.flags.invalidate(body.key);
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: existing ? "feature_flag_updated" : "feature_flag_created",
        targetEntityType: "feature_flag",
        targetEntityId: row.id,
        metadata: {
          key: body.key,
          before: existing
            ? {
                enabled: existing.enabled,
                description: existing.description,
                variants: existing.variants as never,
              }
            : null,
          after: {
            enabled: body.enabled,
            description: body.description,
            variants: (body.variants ?? null) as never,
          },
        },
      },
    );
    return reply.send({ id: row.id, key: row.key, enabled: row.enabled });
  });

  app.patch<{ Params: { key: string } }>("/:key", async (req, reply) => {
    const body = patchSchema.parse(req.body);
    const principal = req.admin!;
    const existing = await app.prisma.featureFlag.findUnique({ where: { key: req.params.key } });
    if (!existing) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    const updated = await app.prisma.featureFlag.update({
      where: { key: req.params.key },
      data: {
        enabled: body.enabled ?? existing.enabled,
        description: body.description ?? existing.description,
        variants: (body.variants ?? existing.variants ?? undefined) as never,
        updatedByAdminUserId: principal.adminUserId,
      },
    });
    app.flags.invalidate(req.params.key);
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "feature_flag_updated",
        targetEntityType: "feature_flag",
        targetEntityId: updated.id,
        metadata: {
          key: req.params.key,
          before: {
            enabled: existing.enabled,
            description: existing.description,
            variants: existing.variants as never,
          },
          after: {
            enabled: updated.enabled,
            description: updated.description,
            variants: updated.variants as never,
          },
        },
      },
    );
    return reply.send({
      id: updated.id,
      key: updated.key,
      enabled: updated.enabled,
      description: updated.description,
      variants: updated.variants,
    });
  });
};
