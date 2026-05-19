import { currentConfig } from "@openmatch/matching";
import type { FastifyPluginAsync } from "fastify";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { listIncomingLikes, rejectIncomingLike } from "../services/likes.service.js";
import { recordSwipe } from "../services/swipe.service.js";

// Generous per-user limit on like actions; anti-abuse only. Never paid.
const LIKES_LIMIT = { max: 200, timeWindow: "1 minute" } as const;

export const likesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  // Always free. Visibility is a user preference, never paywalled.
  app.get("/incoming", async (req) => {
    return listIncomingLikes(app.prisma, req.userId!);
  });

  app.post<{ Params: { likeId: string } }>(
    "/:likeId/accept",
    { config: { rateLimit: LIKES_LIMIT } },
    async (req, reply) => {
      const like = await app.prisma.like.findUnique({
        where: { id: req.params.likeId },
      });
      if (!like || like.toUserId !== req.userId!) {
        return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      }
      const targetProfile = await app.prisma.profile.findUnique({
        where: { userId: like.fromUserId },
      });
      if (!targetProfile) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      const result = await recordSwipe(app.prisma, {
        viewerUserId: req.userId!,
        targetUserId: like.fromUserId,
        decision: "like",
        algorithmVersion: currentConfig.algorithmVersion,
        rankingConfigVersion: currentConfig.rankingConfigVersion,
        deckSessionId: "likes-tab",
      });
      return reply.send(result);
    },
  );

  app.post<{ Params: { likeId: string } }>(
    "/:likeId/reject",
    { config: { rateLimit: LIKES_LIMIT } },
    async (req, reply) => {
      const result = await rejectIncomingLike(app.prisma, req.params.likeId, req.userId!);
      if (!result.rejected) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      return reply.send({ rejected: true });
    },
  );
};
