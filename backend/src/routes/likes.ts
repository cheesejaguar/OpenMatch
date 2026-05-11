import { currentConfig } from "@openmatch/matching";
import type { FastifyPluginAsync } from "fastify";
import { listIncomingLikes, rejectIncomingLike } from "../services/likes.service.js";
import { recordSwipe } from "../services/swipe.service.js";

export const likesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  // Always free. Visibility is a user preference, never paywalled.
  app.get("/incoming", async (req) => {
    return listIncomingLikes(app.prisma, req.userId!);
  });

  app.post<{ Params: { likeId: string } }>("/:likeId/accept", async (req, reply) => {
    const like = await app.prisma.like.findUnique({
      where: { id: req.params.likeId },
    });
    if (!like || like.toUserId !== req.userId!) {
      return reply.code(404).send({ error: "not_found" });
    }
    const targetProfile = await app.prisma.profile.findUnique({
      where: { userId: like.fromUserId },
    });
    if (!targetProfile) return reply.code(404).send({ error: "not_found" });
    const result = await recordSwipe(app.prisma, {
      viewerUserId: req.userId!,
      targetUserId: like.fromUserId,
      decision: "like",
      algorithmVersion: currentConfig.algorithmVersion,
      rankingConfigVersion: currentConfig.rankingConfigVersion,
      deckSessionId: "likes-tab",
    });
    return reply.send(result);
  });

  app.post<{ Params: { likeId: string } }>("/:likeId/reject", async (req, reply) => {
    const result = await rejectIncomingLike(app.prisma, req.params.likeId, req.userId!);
    if (!result.rejected) return reply.code(404).send({ error: "not_found" });
    return reply.send({ rejected: true });
  });
};
