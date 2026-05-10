import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { recordSwipe, undoSwipe } from "../services/swipe.service.js";

const swipeSchema = z.object({
  targetProfileId: z.string(),
  decision: z.enum(["like", "reject"]),
  deckSessionId: z.string(),
  algorithmVersion: z.string(),
  rankingConfigVersion: z.string(),
});

export const swipesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  // Generous limit; anti-abuse only. Never paid.
  app.register(async (instance) => {
    instance.post(
      "/",
      {
        config: {
          rateLimit: {
            max: 120,
            timeWindow: "1 minute",
          },
        },
      },
      async (req, reply) => {
        const body = swipeSchema.parse(req.body);
        const targetProfile = await app.prisma.profile.findUnique({
          where: { id: body.targetProfileId },
          select: { userId: true },
        });
        if (!targetProfile) {
          return reply.code(404).send({ error: "target_not_found" });
        }
        const result = await recordSwipe(app.prisma, {
          viewerUserId: req.userId!,
          targetUserId: targetProfile.userId,
          decision: body.decision,
          algorithmVersion: body.algorithmVersion,
          rankingConfigVersion: body.rankingConfigVersion,
          deckSessionId: body.deckSessionId,
        });
        return reply.send(result);
      },
    );
  });

  app.post<{ Params: { swipeId: string } }>("/:swipeId/undo", async (req, reply) => {
    const result = await undoSwipe(app.prisma, req.userId!, req.params.swipeId);
    if (!result.undone) {
      return reply.code(400).send({
        error: "undo_not_available",
        message:
          "Undo is free, but it has integrity limits — your action may be too old, already undone, or affected by moderation.",
      });
    }
    return reply.send({ undone: true });
  });
};
