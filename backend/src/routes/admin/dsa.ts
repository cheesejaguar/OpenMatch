import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { acknowledgeNotice, decideNotice } from "../../services/dsa.service.js";

// Admin operator actions on DSA Art. 16 notices. Two state transitions
// are exposed:
//
//   POST /:id/acknowledge — first-touch ack (stops the 24h SLA clock).
//   POST /:id/decide      — substantive ruling (actioned/rejected/withdrawn).
//
// Both write an AdminAuditLog row tagged with the new
// `dsa_notice_acknowledged` / `dsa_notice_decided` event types.

const decideSchema = z.object({
  decision: z.enum(["actioned", "rejected", "withdrawn"]),
  note: z.string().max(2000).optional(),
});

export const adminDsaRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  // Re-use the report-resolve permission for DSA actions. A future
  // round can split this into a dedicated `dsa.review` permission if
  // operator volume justifies it.
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.REPORT_RESOLVE));

  app.get("/", async (req, reply) => {
    const q = z
      .object({
        status: z
          .enum(["received", "acknowledged", "in_review", "actioned", "rejected", "withdrawn"])
          .optional(),
        breached: z.enum(["ack", "decision", "any"]).optional(),
        limit: z.coerce.number().int().positive().max(200).default(50),
      })
      .parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.breached === "ack") where.slaAckBreachedAt = { not: null };
    if (q.breached === "decision") where.slaDecisionBreachedAt = { not: null };
    if (q.breached === "any") {
      where.OR = [{ slaAckBreachedAt: { not: null } }, { slaDecisionBreachedAt: { not: null } }];
    }
    const rows = await app.prisma.noticeAndActionReport.findMany({
      where,
      orderBy: [{ slaAckDueAt: "asc" }],
      take: q.limit,
      select: {
        id: true,
        category: true,
        status: true,
        receivedAt: true,
        acknowledgedAt: true,
        respondedAt: true,
        slaAckDueAt: true,
        slaDecisionDueAt: true,
        slaAckBreachedAt: true,
        slaDecisionBreachedAt: true,
        contentReference: true,
        description: true,
        affectedUserId: true,
        reporterEmail: true,
      },
    });
    return reply.send({ items: rows });
  });

  app.post<{ Params: { id: string } }>("/:id/acknowledge", async (req, reply) => {
    const principal = req.admin!;
    const existing = await app.prisma.noticeAndActionReport.findUnique({
      where: { id: req.params.id },
      select: { id: true, acknowledgedAt: true },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.acknowledgedAt) {
      return reply.send({ id: existing.id, acknowledgedAt: existing.acknowledgedAt });
    }
    const updated = await acknowledgeNotice(app.prisma, req.params.id, principal.adminUserId);
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "dsa_notice_acknowledged",
        targetEntityType: "dsa_notice",
        targetEntityId: req.params.id,
      },
    );
    return reply.send({ id: updated.id, acknowledgedAt: updated.acknowledgedAt });
  });

  app.post<{ Params: { id: string } }>("/:id/decide", async (req, reply) => {
    const body = decideSchema.parse(req.body);
    const principal = req.admin!;
    const existing = await app.prisma.noticeAndActionReport.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const updated = await decideNotice(
      app.prisma,
      req.params.id,
      principal.adminUserId,
      body.decision,
    );
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "dsa_notice_decided",
        targetEntityType: "dsa_notice",
        targetEntityId: req.params.id,
        metadata: { decision: body.decision, note: body.note ?? null },
      },
    );
    return reply.send({
      id: updated.id,
      status: updated.status,
      respondedAt: updated.respondedAt,
    });
  });
};
