import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { recordSwipe, undoSwipe } from "../services/swipe.service.js";

const swipeSchema = z.object({
  targetProfileId: z.string(),
  decision: z.enum(["like", "reject"]),
  deckSessionId: z.string(),
  algorithmVersion: z.string(),
  rankingConfigVersion: z.string(),
});

// Round A — Fastify response schema for POST /swipes. Locks the DTO
// shape so server-side changes that diverge from the iOS / admin
// contract fail in tests instead of at runtime on-device.
//
// recordSwipe() returns one of:
//   { swipeId: null,   matched: false }                            (no-op duplicate)
//   { swipeId: string, matched: false }                            (one-sided like / reject)
//   { swipeId: string, matched: true,  matchId: string }           (mutual match)
const swipeResultSchema = z.object({
  swipeId: z.string().nullable(),
  matched: z.boolean(),
  matchId: z.string().optional(),
});

const undoResponseSchema = z.object({ undone: z.literal(true) });

export const swipesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  // `.withTypeProvider<ZodTypeProvider>()` opts this scope into Zod-based
  // request / response schemas. Other route plugins keep the default
  // until they migrate.
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Generous limit; anti-abuse only. Never paid.
  r.post(
    "/",
    {
      config: {
        rateLimit: { max: 100, timeWindow: "1 minute" },
      },
      schema: {
        body: swipeSchema,
        response: { 200: swipeResultSchema },
      },
    },
    async (req, reply) => {
      // Body is already validated by the type provider, but discovery /
      // chat services downstream still expect explicit fields, so we
      // pass the parsed object through unchanged.
      const body = req.body;
      const targetProfile = await app.prisma.profile.findUnique({
        where: { id: body.targetProfileId },
        select: { userId: true },
      });
      if (!targetProfile) {
        return sendHttpError(reply, httpError(ErrorCodes.TARGET_NOT_FOUND));
      }
      const skipMatch = await app.flags.evaluate("match_pipeline_paused");
      const result = await recordSwipe(app.prisma, {
        viewerUserId: req.userId!,
        targetUserId: targetProfile.userId,
        decision: body.decision,
        algorithmVersion: body.algorithmVersion,
        rankingConfigVersion: body.rankingConfigVersion,
        deckSessionId: body.deckSessionId,
        skipMatch,
      });
      return reply.send(result);
    },
  );

  r.post(
    "/:swipeId/undo",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ swipeId: z.string() }),
        response: { 200: undoResponseSchema },
      },
    },
    async (req, reply) => {
      const result = await undoSwipe(app.prisma, req.userId!, req.params.swipeId);
      if (!result.undone) {
        return sendHttpError(
          reply,
          httpError(ErrorCodes.UNDO_NOT_AVAILABLE, {
            message:
              "Undo is free, but it has integrity limits — your action may be too old, already undone, or affected by moderation.",
          }),
        );
      }
      return reply.send({ undone: true });
    },
  );
};
