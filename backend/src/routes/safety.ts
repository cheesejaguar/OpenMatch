import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  blockUser,
  listBlockedUsers,
  reportUser,
  unblockUser,
} from "../services/safety.service.js";

const reportSchema = z.object({
  reportedUserId: z.string(),
  reason: z.enum([
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
    "other",
  ]),
  details: z.string().max(2000).optional(),
  reportedProfileId: z.string().optional(),
  reportedMessageId: z.string().optional(),
});

const blockSchema = z.object({ blockedUserId: z.string() });

export const safetyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/report",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = reportSchema.parse(req.body);
      try {
        const report = await reportUser(
          app.prisma,
          req.userId!,
          body.reportedUserId,
          body.reason,
          body.details,
          body.reportedProfileId,
          body.reportedMessageId,
        );
        app.log.info(
          {
            event: "safety.report",
            reportId: report.id,
            reporterUserId: req.userId,
            reportedUserId: body.reportedUserId,
            reason: body.reason,
          },
          "user_reported",
        );
        return reply.send({ reportId: report.id, status: report.status });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
      }
    },
  );

  app.post(
    "/block",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = blockSchema.parse(req.body);
      try {
        await blockUser(app.prisma, req.userId!, body.blockedUserId);
        app.log.info(
          {
            event: "safety.block",
            blockerUserId: req.userId,
            blockedUserId: body.blockedUserId,
          },
          "user_blocked",
        );
        return reply.code(204).send();
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
      }
    },
  );

  app.delete<{ Params: { userId: string } }>("/block/:userId", async (req, reply) => {
    await unblockUser(app.prisma, req.userId!, req.params.userId);
    app.log.info(
      {
        event: "safety.unblock",
        blockerUserId: req.userId,
        blockedUserId: req.params.userId,
      },
      "user_unblocked",
    );
    return reply.code(204).send();
  });

  app.get("/blocked-users", async (req) => listBlockedUsers(app.prisma, req.userId!));
};
