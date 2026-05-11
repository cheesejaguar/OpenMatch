import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  auditContextFromRequest,
  withAuditedTransaction,
  writeAudit,
} from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { permsFrom } from "../../lib/admin/serialize.js";
import {
  getReportDetail,
  listReports,
  resolveReport,
} from "../../services/admin/reports.service.js";

const listSchema = z.object({
  status: z.enum(["open", "reviewing", "resolved", "dismissed"]).optional(),
  reason: z.string().optional(),
  assignedAdminUserId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  cursor: z.string().optional(),
});

const reasonCodeSchema = z.enum([
  "harassment",
  "hate_or_discrimination",
  "threats_or_violence",
  "sexual_content",
  "scam_or_spam",
  "fake_profile",
  "underage",
  "impersonation",
  "offensive_profile",
  "off_platform_solicitation",
  "ban_evasion",
  "other",
]);

const resolveSchema = z.object({
  resolution: z.enum([
    "no_action",
    "warning",
    "content_removed",
    "temporary_suspension",
    "permanent_ban",
  ]),
  reasonCode: reasonCodeSchema,
  internalNote: z.string().max(4000).optional(),
  userFacingExplanation: z.string().max(2000).optional(),
});

const noteSchema = z.object({ body: z.string().min(1).max(8000) });
const assignSchema = z.object({ adminUserId: z.string().min(1) });

export const adminReportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);

  app.get(
    "/",
    { preHandler: app.requirePermission(PERMISSIONS.REPORT_READ_ALL) },
    async (req, reply) => {
      const q = listSchema.parse(req.query);
      const principal = req.admin!;
      const result = await listReports(app.prisma, q, permsFrom(principal.permissions));
      return reply.send(result);
    },
  );

  app.get<{ Params: { reportId: string } }>(
    "/:reportId",
    { preHandler: app.requirePermission(PERMISSIONS.REPORT_READ_ALL) },
    async (req, reply) => {
      const principal = req.admin!;
      const detail = await getReportDetail(
        app.prisma,
        req.params.reportId,
        permsFrom(principal.permissions),
      );
      if (!detail) return reply.code(404).send({ error: "not_found" });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "report_opened",
          targetEntityType: "report",
          targetEntityId: req.params.reportId,
          reportId: req.params.reportId,
        },
      );
      return reply.send(detail);
    },
  );

  app.post<{ Params: { reportId: string } }>(
    "/:reportId/assign",
    { preHandler: app.requirePermission(PERMISSIONS.REPORT_ASSIGN) },
    async (req, reply) => {
      const body = assignSchema.parse(req.body);
      const principal = req.admin!;
      const r = await app.prisma.report.update({
        where: { id: req.params.reportId },
        data: { assignedAdminUserId: body.adminUserId, status: "reviewing" },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "report_assigned",
          targetEntityType: "report",
          targetEntityId: r.id,
          reportId: r.id,
          metadata: { assignedAdminUserId: body.adminUserId },
        },
      );
      return reply.send({ reportId: r.id, status: r.status });
    },
  );

  app.post<{ Params: { reportId: string } }>(
    "/:reportId/escalate",
    { preHandler: app.requirePermission(PERMISSIONS.REPORT_ESCALATE) },
    async (req, reply) => {
      const principal = req.admin!;
      const r = await app.prisma.report.update({
        where: { id: req.params.reportId },
        data: { status: "reviewing" },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "report_escalated",
          targetEntityType: "report",
          targetEntityId: r.id,
          reportId: r.id,
        },
      );
      return reply.send({ reportId: r.id, status: r.status });
    },
  );

  app.post<{ Params: { reportId: string } }>(
    "/:reportId/dismiss",
    { preHandler: app.requirePermission(PERMISSIONS.REPORT_RESOLVE) },
    async (req, reply) => {
      const principal = req.admin!;
      const r = await app.prisma.report.update({
        where: { id: req.params.reportId },
        data: {
          status: "dismissed",
          resolution: "no_action",
          resolvedAt: new Date(),
          moderatorId: principal.adminUserId,
        },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "report_dismissed",
          targetEntityType: "report",
          targetEntityId: r.id,
          reportId: r.id,
        },
      );
      return reply.send({ reportId: r.id, status: r.status });
    },
  );

  app.post<{ Params: { reportId: string } }>(
    "/:reportId/resolve",
    { preHandler: app.requirePermission(PERMISSIONS.REPORT_RESOLVE) },
    async (req, reply) => {
      const body = resolveSchema.parse(req.body);
      const principal = req.admin!;
      // Permission tighten-up: permanent-ban resolutions require
      // user.ban.permanent in addition to report.resolve.
      if (
        body.resolution === "permanent_ban" &&
        !principal.permissions.includes(PERMISSIONS.USER_BAN_PERMANENT)
      ) {
        return reply.code(403).send({
          error: "forbidden",
          required: PERMISSIONS.USER_BAN_PERMANENT,
        });
      }
      try {
        const { report, action } = await withAuditedTransaction(
          app.prisma,
          auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
          {
            eventType: "report_resolved",
            targetEntityType: "report",
            targetEntityId: req.params.reportId,
            reportId: req.params.reportId,
            metadata: { resolution: body.resolution, reasonCode: body.reasonCode },
          },
          async (tx) => {
            const { report, moderationAction } = await resolveReport(
              app.prisma,
              {
                reportId: req.params.reportId,
                resolution: body.resolution,
                reasonCode: body.reasonCode,
                internalNote: body.internalNote ?? null,
                userFacingExplanation: body.userFacingExplanation ?? null,
                adminUserId: principal.adminUserId,
              },
              tx,
            );
            return {
              result: { report, action: moderationAction },
              moderationActionId: moderationAction.id,
            };
          },
        );
        return reply.send({
          reportId: report.id,
          status: report.status,
          resolution: report.resolution,
          moderationActionId: action.id,
        });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
      }
    },
  );

  app.post<{ Params: { reportId: string } }>(
    "/:reportId/notes",
    { preHandler: app.requirePermission(PERMISSIONS.USER_NOTE_WRITE) },
    async (req, reply) => {
      const body = noteSchema.parse(req.body);
      const principal = req.admin!;
      const note = await app.prisma.adminNote.create({
        data: {
          targetReportId: req.params.reportId,
          body: body.body,
          createdByAdminUserId: principal.adminUserId,
        },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "note_added",
          targetEntityType: "report",
          targetEntityId: req.params.reportId,
          reportId: req.params.reportId,
          metadata: { noteId: note.id },
        },
      );
      return reply.send({ noteId: note.id, createdAt: note.createdAt.toISOString() });
    },
  );
};
