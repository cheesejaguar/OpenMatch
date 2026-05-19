import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { ErrorCodes } from "../../lib/error-codes.js";
import { httpError, sendHttpError } from "../../lib/http-error.js";

const listSchema = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

export const adminFeedbackRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);

  app.get(
    "/",
    { preHandler: app.requirePermission(PERMISSIONS.FEEDBACK_READ) },
    async (req, reply) => {
      const q = listSchema.parse(req.query);
      const where: Record<string, unknown> = {};
      if (q.status === "open") where.resolvedAt = null;
      if (q.status === "resolved") where.resolvedAt = { not: null };
      const take = q.limit + 1;
      const rows = await app.prisma.betaFeedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      });
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      return reply.send({
        items: items.map((r) => ({
          id: r.id,
          userId: r.userId,
          category: r.category,
          body: r.body,
          appVersion: r.appVersion,
          osVersion: r.osVersion,
          deviceModel: r.deviceModel,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          resolvedByAdminUserId: r.resolvedByAdminUserId,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? items[items.length - 1]?.id : null,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/resolve",
    { preHandler: app.requirePermission(PERMISSIONS.FEEDBACK_RESOLVE) },
    async (req, reply) => {
      const principal = req.admin!;
      const existing = await app.prisma.betaFeedback.findUnique({ where: { id: req.params.id } });
      if (!existing) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      if (existing.resolvedAt) {
        return reply.send({
          id: existing.id,
          resolvedAt: existing.resolvedAt.toISOString(),
          alreadyResolved: true,
        });
      }
      const row = await app.prisma.betaFeedback.update({
        where: { id: req.params.id },
        data: {
          resolvedAt: new Date(),
          resolvedByAdminUserId: principal.adminUserId,
        },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "feedback_resolved",
          targetEntityType: "beta_feedback",
          targetEntityId: row.id,
        },
      );
      return reply.send({ id: row.id, resolvedAt: row.resolvedAt?.toISOString() });
    },
  );
};
