import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import {
  AccessReasonRequiredError,
  createAccessGrant,
  requireAccessGrant,
} from "../../lib/admin/sensitive-access.js";

const accessGrantSchema = z.object({
  entityType: z.enum(["conversation", "photo", "user", "profile", "message"]),
  entityId: z.string().min(1),
  reason: z.enum([
    "active_report_investigation",
    "user_appeal",
    "scam_investigation",
    "impersonation_investigation",
    "safety_escalation",
    "legal_compliance",
    "quality_review",
    "other",
  ]),
  note: z.string().max(2000).optional(),
  reportId: z.string().optional(),
});

const messagesQuerySchema = z.object({
  accessGrantId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  before: z.string().datetime().optional(),
});

export const adminConversationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);

  // Create a sensitive access grant. The UI presents the modal (PRD §9.3)
  // then calls this to obtain a grantId before opening the conversation.
  app.post("/access-grants", async (req, reply) => {
    const body = accessGrantSchema.parse(req.body);
    const principal = req.admin!;
    const grant = await createAccessGrant({
      prisma: app.prisma,
      adminUserId: principal.adminUserId,
      entityType: body.entityType,
      entityId: body.entityId,
      reason: body.reason,
      note: body.note ?? null,
      reportId: body.reportId ?? null,
    });
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "sensitive_access_granted",
        targetEntityType: body.entityType,
        targetEntityId: body.entityId,
        accessReason: body.reason,
        reportId: body.reportId ?? null,
        sensitiveAccessGrantId: grant.id,
        metadata: { note: body.note ?? null },
      },
    );
    return reply.send({
      accessGrantId: grant.id,
      expiresAt: grant.expiresAt.toISOString(),
    });
  });

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId",
    { preHandler: app.requirePermission(PERMISSIONS.MESSAGE_READ_ALL) },
    async (req, reply) => {
      const principal = req.admin!;
      const convo = await app.prisma.conversation.findUnique({
        where: { id: req.params.conversationId },
        include: {
          match: {
            include: {
              userA: { include: { profile: true } },
              userB: { include: { profile: true } },
            },
          },
        },
      });
      if (!convo) return reply.code(404).send({ error: "not_found" });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "conversation_viewed",
          targetEntityType: "conversation",
          targetEntityId: convo.id,
        },
      );
      return reply.send({
        conversationId: convo.id,
        matchId: convo.matchId,
        status: convo.status,
        createdAt: convo.createdAt.toISOString(),
        participants: [
          {
            userId: convo.match.userAId,
            displayName: convo.match.userA.profile?.displayName ?? null,
          },
          {
            userId: convo.match.userBId,
            displayName: convo.match.userB.profile?.displayName ?? null,
          },
        ],
      });
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/messages",
    { preHandler: app.requirePermission(PERMISSIONS.MESSAGE_READ_ALL) },
    async (req, reply) => {
      const q = messagesQuerySchema.parse(req.query);
      const principal = req.admin!;
      try {
        const grant = await requireAccessGrant({
          prisma: app.prisma,
          adminUserId: principal.adminUserId,
          entityType: "conversation",
          entityId: req.params.conversationId,
          grantId: q.accessGrantId,
        });
        const messages = await app.prisma.message.findMany({
          where: {
            conversationId: req.params.conversationId,
            ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: q.limit,
        });
        await writeAudit(
          app.prisma,
          auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
          {
            eventType: "message_viewed",
            targetEntityType: "conversation",
            targetEntityId: req.params.conversationId,
            accessReason: grant.reason,
            reportId: grant.reportId,
            sensitiveAccessGrantId: grant.id,
            metadata: { messageCount: messages.length },
          },
        );
        return reply.send({
          messages: messages.reverse().map((m) => ({
            id: m.id,
            senderUserId: m.senderUserId,
            body: m.body,
            createdAt: m.createdAt.toISOString(),
            deliveredAt: m.deliveredAt?.toISOString() ?? null,
            readAt: m.readAt?.toISOString() ?? null,
            deletedAt: m.deletedAt?.toISOString() ?? null,
            moderationStatus: m.moderationStatus,
          })),
        });
      } catch (err) {
        if (err instanceof AccessReasonRequiredError) {
          return reply.code(412).send({
            error: err.code,
            entityType: err.entityType,
            entityId: err.entityId,
          });
        }
        const e = err as { statusCode?: number; message?: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
      }
    },
  );
};
