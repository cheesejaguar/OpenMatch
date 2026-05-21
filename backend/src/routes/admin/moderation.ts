import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { ErrorCodes } from "../../lib/error-codes.js";
import { httpError, sendHttpError } from "../../lib/http-error.js";

const querySchema = z.object({
  surface: z.enum(["bio", "message", "display_name", "photo_caption", "all"]).default("all"),
  decision: z.enum(["flag", "block", "all"]).default("flag"),
  resolved: z.enum(["open", "resolved", "all"]).default("open"),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

const resolveSchema = z.object({
  resolution: z.enum(["dismissed", "warned", "removed", "banned"]),
  note: z.string().max(2000).optional(),
});

const summaryQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

export const adminModerationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);

  app.get(
    "/flags",
    { preHandler: app.requirePermission(PERMISSIONS.MESSAGE_READ_REPORT_CONTEXT) },
    async (req, reply) => {
      const q = querySchema.parse(req.query);
      const where: Record<string, unknown> = {};
      if (q.surface !== "all") where.surface = q.surface;
      if (q.decision !== "all") where.decision = q.decision;
      if (q.resolved === "open") where.resolvedAt = null;
      else if (q.resolved === "resolved") where.resolvedAt = { not: null };
      const take = Math.min(q.limit, 200) + 1;
      const rows = await app.prisma.moderationFlag.findMany({
        where: where as never,
        take,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          targetUserId: true,
          surface: true,
          decision: true,
          reasonCode: true,
          excerpt: true,
          provider: true,
          details: true,
          targetMessageId: true,
          targetProfileId: true,
          resolvedAt: true,
          resolvedByAdminUserId: true,
          resolution: true,
          createdAt: true,
        },
      });
      const next = rows.length > take - 1 ? rows[take - 1]!.id : null;
      return reply.send({
        flags: rows.slice(0, take - 1),
        nextCursor: next,
      });
    },
  );

  app.post<{ Params: { flagId: string } }>(
    "/flags/:flagId/resolve",
    { preHandler: app.requirePermission(PERMISSIONS.MESSAGE_READ_REPORT_CONTEXT) },
    async (req, reply) => {
      const body = resolveSchema.parse(req.body);
      const principal = req.admin!;
      const row = await app.prisma.moderationFlag.findUnique({
        where: { id: req.params.flagId },
      });
      if (!row) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      if (row.resolvedAt) return sendHttpError(reply, httpError(ErrorCodes.CONFLICT));
      await app.prisma.moderationFlag.update({
        where: { id: row.id },
        data: {
          resolvedAt: new Date(),
          resolvedByAdminUserId: principal.adminUserId,
          resolution: body.resolution,
        },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "note_added",
          targetEntityType: "user",
          targetEntityId: row.targetUserId,
          metadata: {
            flagId: row.id,
            resolution: body.resolution,
            surface: row.surface,
            reasonCode: row.reasonCode,
          },
        },
      );
      return reply.send({ ok: true });
    },
  );

  // Scam-signals-per-hour widget data. Aggregates over both
  // ModerationFlag (heuristic) and ScamSignal (rules-based) so the
  // /overview card shows the whole T&S signal volume in one chart.
  app.get(
    "/summary",
    { preHandler: app.requirePermission(PERMISSIONS.METRICS_READ) },
    async (req, reply) => {
      const q = summaryQuerySchema.parse(req.query);
      const since = new Date(Date.now() - q.hours * 60 * 60 * 1000);
      const [flagCount, scamSignalCount, byReason] = await Promise.all([
        app.prisma.moderationFlag.count({ where: { createdAt: { gte: since } } }),
        app.prisma.scamSignal.count({ where: { createdAt: { gte: since } } }),
        app.prisma.moderationFlag.groupBy({
          by: ["reasonCode"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
          orderBy: { _count: { reasonCode: "desc" } },
          take: 10,
        }),
      ]);
      return reply.send({
        windowHours: q.hours,
        moderationFlagCount: flagCount,
        scamSignalCount,
        topReasons: byReason.map((r) => ({ reasonCode: r.reasonCode, count: r._count._all })),
      });
    },
  );
};
