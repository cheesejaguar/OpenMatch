import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";

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
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.METRO_MANAGE));

  app.get("/", async (_req, reply) => {
    const rows = await app.prisma.metroBoundary.findMany({ orderBy: { slug: "asc" } });
    return reply.send({ items: rows });
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const principal = req.admin!;
    const row = await app.prisma.metroBoundary.create({
      data: { ...body, countryCode: body.countryCode.toUpperCase() },
    });
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
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const row = await app.prisma.metroBoundary.update({
      where: { id: req.params.id },
      data: {
        ...body,
        countryCode: body.countryCode ? body.countryCode.toUpperCase() : undefined,
      },
    });
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
