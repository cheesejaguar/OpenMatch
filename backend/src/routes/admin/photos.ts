import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { serializePhoto } from "../../lib/admin/serialize.js";

const queueSchema = z.object({
  queue: z.enum(["pending", "flagged", "removed", "all"]).default("pending"),
  limit: z.coerce.number().int().positive().max(100).default(50),
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

const actionSchema = z.object({
  reasonCode: reasonCodeSchema.optional(),
  internalNote: z.string().max(4000).optional(),
});

export const adminPhotoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);

  app.get(
    "/",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_MODERATE) },
    async (req, reply) => {
      const q = queueSchema.parse(req.query);
      const where =
        q.queue === "pending"
          ? { moderationStatus: "under_review" as const }
          : q.queue === "flagged"
            ? { moderationStatus: "restricted" as const }
            : q.queue === "removed"
              ? { moderationStatus: "removed" as const }
              : {};
      const take = Math.min(q.limit, 100) + 1;
      const rows = await app.prisma.profilePhoto.findMany({
        where,
        take,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
        orderBy: { createdAt: "desc" },
      });
      const next = rows.length > take - 1 ? rows[take - 1]!.id : null;
      return reply.send({
        photos: rows.slice(0, take - 1).map((p) => serializePhoto(p, p.cdnUrl)),
        nextCursor: next,
      });
    },
  );

  async function photoAction(
    req: FastifyRequest<{ Params: { photoId: string } }>,
    reply: FastifyReply,
    nextStatus: "reviewed_ok" | "restricted" | "removed",
    eventType: "photo_approved" | "photo_rejected" | "photo_removed",
  ) {
    const body = actionSchema.parse(req.body);
    const principal = req.admin!;
    const photo = await app.prisma.profilePhoto.findUnique({
      where: { id: req.params.photoId },
    });
    if (!photo) return reply.code(404).send({ error: "not_found" });
    const updated = await app.prisma.$transaction(async (tx) => {
      const updated = await tx.profilePhoto.update({
        where: { id: photo.id },
        data: { moderationStatus: nextStatus },
      });
      await tx.moderationAction.create({
        data: {
          targetPhotoId: photo.id,
          targetProfileId: photo.profileId,
          actionType:
            nextStatus === "removed"
              ? "content_removed"
              : nextStatus === "restricted"
                ? "content_removed"
                : "no_action",
          reasonCode: body.reasonCode ?? "other",
          internalNote: body.internalNote ?? null,
          createdByAdminUserId: principal.adminUserId,
        },
      });
      return updated;
    });
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType,
        targetEntityType: "photo",
        targetEntityId: photo.id,
        metadata: { profileId: photo.profileId, reasonCode: body.reasonCode ?? null },
      },
    );
    return reply.send({ photoId: updated.id, moderationStatus: updated.moderationStatus });
  }

  app.post<{ Params: { photoId: string } }>(
    "/:photoId/approve",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_MODERATE) },
    (req, reply) => photoAction(req, reply, "reviewed_ok", "photo_approved"),
  );
  app.post<{ Params: { photoId: string } }>(
    "/:photoId/reject",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_MODERATE) },
    (req, reply) => photoAction(req, reply, "restricted", "photo_rejected"),
  );
  app.post<{ Params: { photoId: string } }>(
    "/:photoId/remove",
    { preHandler: app.requirePermission(PERMISSIONS.PHOTO_MODERATE) },
    (req, reply) => photoAction(req, reply, "removed", "photo_removed"),
  );
};
