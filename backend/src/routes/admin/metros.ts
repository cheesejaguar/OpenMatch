import type { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { ErrorCodes } from "../../lib/error-codes.js";
import { httpError, sendHttpError } from "../../lib/http-error.js";
import { invalidateMetros } from "../../lib/metros-cache.js";

// MetroBoundary CRUD for the beta geo-fence. The plugin
// `metro-gate.ts` consumes this table at request time.

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusKm: z.number().positive().max(2000),
  countryCode: z.string().length(2),
  active: z.boolean().default(true),
});

const patchSchema = createSchema.partial();

export const adminMetrosRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.METRO_MANAGE));

  app.get("/", async (_req, reply) => {
    const rows = await app.prisma.metroBoundary.findMany({ orderBy: { slug: "asc" } });
    return reply.send({ items: rows });
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const principal = req.admin!;
    // SEV-V11 — explicit allow-list rather than `...body`. If a future
    // column lands on MetroBoundary and is accidentally also added to
    // the Zod createSchema, only the fields enumerated below will be
    // written via this route; everything else stays server-set.
    const createData: Prisma.MetroBoundaryCreateInput = {
      slug: body.slug,
      name: body.name,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      radiusKm: body.radiusKm,
      countryCode: body.countryCode.toUpperCase(),
      active: body.active,
    };
    const row = await app.prisma.metroBoundary.create({ data: createData });
    invalidateMetros(); // PERF-B12 — drop the LRU so new metro propagates immediately
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "metro_created",
        targetEntityType: "metro_boundary",
        targetEntityId: row.id,
        metadata: { slug: row.slug, radiusKm: row.radiusKm, countryCode: row.countryCode },
      },
    );
    return reply.send(row);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = patchSchema.parse(req.body);
    const principal = req.admin!;
    const existing = await app.prisma.metroBoundary.findUnique({ where: { id: req.params.id } });
    if (!existing) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    // SEV-V11 — explicit allow-list for the PATCH path too.
    const updateData: Prisma.MetroBoundaryUpdateInput = {
      ...(body.slug !== undefined && { slug: body.slug }),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.centerLat !== undefined && { centerLat: body.centerLat }),
      ...(body.centerLng !== undefined && { centerLng: body.centerLng }),
      ...(body.radiusKm !== undefined && { radiusKm: body.radiusKm }),
      ...(body.countryCode !== undefined && { countryCode: body.countryCode.toUpperCase() }),
      ...(body.active !== undefined && { active: body.active }),
    };
    const row = await app.prisma.metroBoundary.update({
      where: { id: req.params.id },
      data: updateData,
    });
    invalidateMetros(); // PERF-B12 — drop the LRU so updates propagate immediately
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "metro_updated",
        targetEntityType: "metro_boundary",
        targetEntityId: row.id,
        metadata: { before: existing, after: row },
      },
    );
    return reply.send(row);
  });
};
