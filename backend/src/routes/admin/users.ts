import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  auditContextFromRequest,
  withAuditedTransaction,
  writeAudit,
} from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { permsFrom, serializePhoto } from "../../lib/admin/serialize.js";
import {
  applyBan,
  applyUnban,
  getUserDetail,
  searchUsers,
} from "../../services/admin/users.service.js";

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

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.enum(["active", "paused", "banned", "deleted"]).optional(),
  hasReports: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  cursor: z.string().optional(),
});

const banSchema = z.object({
  type: z.enum(["temporary", "permanent", "safety_hold"]),
  reasonCode: reasonCodeSchema,
  internalNote: z.string().max(4000).optional(),
  userFacingExplanation: z.string().max(2000).optional(),
  durationDays: z.coerce.number().int().positive().max(365).optional(),
  revokeSessions: z.coerce.boolean().optional(),
});

const unbanSchema = z.object({
  reason: z.string().min(1).max(2000),
  internalNote: z.string().max(4000).optional(),
  requireVerification: z.coerce.boolean().optional(),
  requireProfileReview: z.coerce.boolean().optional(),
});

const noteSchema = z.object({ body: z.string().min(1).max(8000) });

export const adminUserRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);

  // GET /users : search
  app.get(
    "/",
    { preHandler: app.requirePermission(PERMISSIONS.USER_READ_SUMMARY) },
    async (req, reply) => {
      const q = searchSchema.parse(req.query);
      const principal = req.admin!;
      const perms = permsFrom(principal.permissions);
      const result = await searchUsers(app.prisma, q, perms);
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        { eventType: "user_viewed", metadata: { search: q } },
      );
      return reply.send(result);
    },
  );

  // GET /users/:id : detail
  app.get<{ Params: { userId: string } }>(
    "/:userId",
    { preHandler: app.requirePermission(PERMISSIONS.USER_READ_FULL_PROFILE) },
    async (req, reply) => {
      const principal = req.admin!;
      const perms = permsFrom(principal.permissions);
      const detail = await getUserDetail(app.prisma, req.params.userId, perms);
      if (!detail) return reply.code(404).send({ error: "not_found" });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "profile_viewed",
          targetEntityType: "user",
          targetEntityId: req.params.userId,
        },
      );
      return reply.send(detail);
    },
  );

  // GET /users/:id/photos
  app.get<{ Params: { userId: string } }>(
    "/:userId/photos",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_READ_ALL) },
    async (req, reply) => {
      const principal = req.admin!;
      const profile = await app.prisma.profile.findUnique({
        where: { userId: req.params.userId },
        include: { photos: { orderBy: { sortOrder: "asc" } } },
      });
      if (!profile) return reply.code(404).send({ error: "not_found" });
      // Photos URLs are already CDN-served in this codebase. A future
      // hardening pass will mint short-lived signed URLs here.
      const dto = profile.photos.map((p) => serializePhoto(p, p.cdnUrl));
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "photo_viewed",
          targetEntityType: "profile",
          targetEntityId: profile.id,
          metadata: { photoCount: dto.length },
        },
      );
      return reply.send({ photos: dto });
    },
  );

  // GET /users/:id/conversations
  app.get<{ Params: { userId: string } }>(
    "/:userId/conversations",
    { preHandler: app.requirePermission(PERMISSIONS.MESSAGE_READ_ALL) },
    async (req, reply) => {
      const principal = req.admin!;
      const matches = await app.prisma.match.findMany({
        where: {
          OR: [{ userAId: req.params.userId }, { userBId: req.params.userId }],
        },
        include: {
          conversation: {
            include: {
              _count: { select: { messages: true } },
              messages: { take: 1, orderBy: { createdAt: "desc" } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      const dto = matches
        .filter((m) => m.conversation)
        .map((m) => ({
          conversationId: m.conversation!.id,
          matchId: m.id,
          otherUserId: m.userAId === req.params.userId ? m.userBId : m.userAId,
          messageCount: m.conversation!._count.messages,
          lastMessageAt: m.conversation!.messages[0]?.createdAt.toISOString() ?? null,
          status: m.conversation!.status,
        }));
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "user_viewed",
          targetEntityType: "user",
          targetEntityId: req.params.userId,
          metadata: { viewed: "conversation_list", count: dto.length },
        },
      );
      return reply.send({ conversations: dto });
    },
  );

  // POST /users/:id/ban
  app.post<{ Params: { userId: string } }>("/:userId/ban", async (req, reply) => {
    const body = banSchema.parse(req.body);
    const principal = req.admin!;
    const needsPermanent = body.type === "permanent";
    const required = needsPermanent
      ? PERMISSIONS.USER_BAN_PERMANENT
      : PERMISSIONS.USER_BAN_TEMPORARY;
    if (!principal.permissions.includes(required)) {
      return reply.code(403).send({ error: "forbidden", required });
    }
    const expiresAt =
      body.type === "temporary" && body.durationDays
        ? new Date(Date.now() + body.durationDays * 86_400_000)
        : null;
    try {
      const ban = await withAuditedTransaction(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: body.type === "permanent" ? "user_banned" : "user_suspended",
          targetEntityType: "user",
          targetEntityId: req.params.userId,
          metadata: { banType: body.type, reasonCode: body.reasonCode },
        },
        async (tx) => {
          const ban = await applyBan(
            app.prisma,
            {
              userId: req.params.userId,
              banType: body.type,
              reasonCode: body.reasonCode,
              internalNote: body.internalNote ?? null,
              userFacingExplanation: body.userFacingExplanation ?? null,
              expiresAt,
              revokeSessions: body.revokeSessions ?? true,
              bannedByAdminUserId: principal.adminUserId,
            },
            tx,
          );
          return { result: ban };
        },
      );
      return reply.send({
        banId: ban.id,
        status: ban.status,
        expiresAt: ban.expiresAt?.toISOString() ?? null,
      });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
    }
  });

  // POST /users/:id/unban
  app.post<{ Params: { userId: string } }>(
    "/:userId/unban",
    { preHandler: app.requirePermission(PERMISSIONS.USER_UNBAN) },
    async (req, reply) => {
      const body = unbanSchema.parse(req.body);
      const principal = req.admin!;
      try {
        const updated = await withAuditedTransaction(
          app.prisma,
          auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
          {
            eventType: "user_unbanned",
            targetEntityType: "user",
            targetEntityId: req.params.userId,
            metadata: {
              requireVerification: body.requireVerification ?? false,
              requireProfileReview: body.requireProfileReview ?? false,
            },
          },
          async (tx) => {
            const updated = await applyUnban(
              app.prisma,
              {
                userId: req.params.userId,
                reason: body.reason,
                internalNote: body.internalNote ?? null,
                requireVerification: body.requireVerification,
                requireProfileReview: body.requireProfileReview,
                unbannedByAdminUserId: principal.adminUserId,
              },
              tx,
            );
            return { result: updated };
          },
        );
        return reply.send({ banId: updated.id, status: updated.status });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
      }
    },
  );

  // POST /users/:id/notes
  app.post<{ Params: { userId: string } }>(
    "/:userId/notes",
    { preHandler: app.requirePermission(PERMISSIONS.USER_NOTE_WRITE) },
    async (req, reply) => {
      const body = noteSchema.parse(req.body);
      const principal = req.admin!;
      const note = await app.prisma.adminNote.create({
        data: {
          targetUserId: req.params.userId,
          body: body.body,
          createdByAdminUserId: principal.adminUserId,
        },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "note_added",
          targetEntityType: "user",
          targetEntityId: req.params.userId,
          metadata: { noteId: note.id },
        },
      );
      return reply.send({ noteId: note.id, createdAt: note.createdAt.toISOString() });
    },
  );

  // GET /users/:id/notes
  app.get<{ Params: { userId: string } }>(
    "/:userId/notes",
    { preHandler: app.requirePermission(PERMISSIONS.USER_READ_FULL_PROFILE) },
    async (req, reply) => {
      const rows = await app.prisma.adminNote.findMany({
        where: { targetUserId: req.params.userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return reply.send({
        notes: rows.map((n) => ({
          id: n.id,
          body: n.body,
          createdByAdminUserId: n.createdByAdminUserId,
          createdAt: n.createdAt.toISOString(),
        })),
      });
    },
  );

  // GET /users/:id/bans
  app.get<{ Params: { userId: string } }>(
    "/:userId/bans",
    { preHandler: app.requirePermission(PERMISSIONS.USER_READ_FULL_PROFILE) },
    async (req, reply) => {
      const bans = await app.prisma.userBan.findMany({
        where: { userId: req.params.userId },
        orderBy: { bannedAt: "desc" },
      });
      return reply.send({
        bans: bans.map((b) => ({
          id: b.id,
          banType: b.banType,
          status: b.status,
          reasonCode: b.reasonCode,
          internalNote: b.internalNote,
          userFacingExplanation: b.userFacingExplanation,
          bannedByAdminUserId: b.bannedByAdminUserId,
          bannedAt: b.bannedAt.toISOString(),
          expiresAt: b.expiresAt?.toISOString() ?? null,
          unbannedByAdminUserId: b.unbannedByAdminUserId,
          unbannedAt: b.unbannedAt?.toISOString() ?? null,
          unbanReason: b.unbanReason,
        })),
      });
    },
  );
};
