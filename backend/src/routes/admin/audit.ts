import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "../../lib/admin/permissions.js";

const listSchema = z.object({
  adminUserId: z.string().optional(),
  eventType: z.string().optional(),
  targetEntityType: z.string().optional(),
  targetEntityId: z.string().optional(),
  accessReason: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

export const adminAuditRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.AUDIT_READ));

  app.get("/", async (req, reply) => {
    const q = listSchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.adminUserId) where.adminUserId = q.adminUserId;
    if (q.eventType) where.eventType = q.eventType;
    if (q.targetEntityType) where.targetEntityType = q.targetEntityType;
    if (q.targetEntityId) where.targetEntityId = q.targetEntityId;
    if (q.accessReason) where.accessReason = q.accessReason;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Record<string, Date>).gte = new Date(q.from);
      if (q.to) (where.createdAt as Record<string, Date>).lte = new Date(q.to);
    }
    const take = Math.min(q.limit, 200) + 1;
    const rows = await app.prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    const next = rows.length > take - 1 ? rows[take - 1]!.id : null;
    return reply.send({
      events: rows.slice(0, take - 1).map((e) => ({
        id: e.id,
        adminUserId: e.adminUserId,
        adminRoleSnapshot: e.adminRoleSnapshot,
        eventType: e.eventType,
        targetEntityType: e.targetEntityType,
        targetEntityId: e.targetEntityId,
        accessReason: e.accessReason,
        reportId: e.reportId,
        moderationActionId: e.moderationActionId,
        sensitiveAccessGrantId: e.sensitiveAccessGrantId,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: next,
    });
  });

  // Aggregate volume of out-of-report sensitive access per admin. PRD §13.3.
  app.get("/sensitive-access-summary", async (_req, reply) => {
    const rows = await app.prisma.$queryRaw<
      { adminUserId: string; eventType: string; count: bigint }[]
    >`
      SELECT "adminUserId", "eventType"::text AS "eventType", COUNT(*)::bigint AS count
      FROM "AdminAuditLog"
      WHERE "eventType" IN ('message_viewed', 'photo_viewed', 'conversation_viewed')
        AND "reportId" IS NULL
        AND "createdAt" > NOW() - INTERVAL '30 days'
      GROUP BY "adminUserId", "eventType"
      ORDER BY count DESC
    `;
    return reply.send({
      windowDays: 30,
      rows: rows.map((r) => ({
        adminUserId: r.adminUserId,
        eventType: r.eventType,
        count: Number(r.count),
      })),
    });
  });
};
