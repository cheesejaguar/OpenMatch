import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { ErrorCodes } from "../../lib/error-codes.js";
import { httpError, sendHttpError } from "../../lib/http-error.js";
import { decideSelfieVerification } from "../../services/verification.service.js";

const queueSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "expired", "all"]).default("pending"),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

const decideSchema = z.object({
  decisionNote: z.string().max(2000).optional(),
});

export const adminVerificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);

  app.get(
    "/",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_MODERATE) },
    async (req, reply) => {
      const q = queueSchema.parse(req.query);
      const where = q.status === "all" ? {} : { status: q.status };
      const take = Math.min(q.limit, 100) + 1;
      const rows = await app.prisma.verificationRequest.findMany({
        where,
        take,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          userId: true,
          kind: true,
          status: true,
          challengePrompt: true,
          imageStorageKey: true,
          imageContentType: true,
          reviewerAdminUserId: true,
          reviewedAt: true,
          decisionNote: true,
          createdAt: true,
        },
      });
      const next = rows.length > take - 1 ? rows[take - 1]!.id : null;
      return reply.send({
        requests: rows.slice(0, take - 1),
        nextCursor: next,
      });
    },
  );

  app.post<{ Params: { requestId: string } }>(
    "/:requestId/approve",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_MODERATE) },
    async (req, reply) => {
      const body = decideSchema.parse(req.body);
      const principal = req.admin!;
      const r = await decideSelfieVerification({
        prisma: app.prisma,
        requestId: req.params.requestId,
        adminUserId: principal.adminUserId,
        decision: "approved",
        decisionNote: body.decisionNote,
      });
      if (!r.ok) {
        if (r.reason === "not_found") {
          return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
        }
        return sendHttpError(reply, httpError(ErrorCodes.CONFLICT));
      }
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "photo_approved",
          targetEntityType: "user",
          targetEntityId: r.userId,
          metadata: { requestId: req.params.requestId, kind: "verification_selfie" },
        },
      );
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { requestId: string } }>(
    "/:requestId/reject",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_MODERATE) },
    async (req, reply) => {
      const body = decideSchema.parse(req.body);
      const principal = req.admin!;
      const r = await decideSelfieVerification({
        prisma: app.prisma,
        requestId: req.params.requestId,
        adminUserId: principal.adminUserId,
        decision: "rejected",
        decisionNote: body.decisionNote,
      });
      if (!r.ok) {
        if (r.reason === "not_found") {
          return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
        }
        return sendHttpError(reply, httpError(ErrorCodes.CONFLICT));
      }
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "photo_rejected",
          targetEntityType: "user",
          targetEntityId: r.userId,
          metadata: { requestId: req.params.requestId, kind: "verification_selfie" },
        },
      );
      return reply.send({ ok: true });
    },
  );
};
