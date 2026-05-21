import { currentConfig } from "@openmatch/matching";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { listIncomingLikes, rejectIncomingLike } from "../services/likes.service.js";
import { recordSwipe } from "../services/swipe.service.js";

// Generous per-user limit on like actions; anti-abuse only. Never paid.
const LIKES_LIMIT = { max: 200, timeWindow: "1 minute" } as const;

// PERF-B16 / PERF-X4 — response schema for GET /likes/incoming.
// listIncomingLikes returns one of three shapes depending on the
// caller's `likesVisibility` preference:
//   - hidden     → { visibility: "hidden", count: null, likes: [] }
//   - count_only → { visibility: "count_only", count: N, likes: [] }
//   - visible    → { visibility: "visible", count: N, likes: Like[] }
// Photos / from-user / profile fields come back via Prisma's
// `include: { from: { include: { profile: { include: { photos } } } } }`
// — we wildcard the nested shape since the existing service uses an
// `include` rather than a narrow `select`. Locking down the nested
// shape is a follow-up tied to peer-DTO consolidation.
const incomingLikesResponseSchema = z.object({
  visibility: z.enum(["visible", "count_only", "hidden"]),
  count: z.number().int().nullable(),
  likes: z.array(z.record(z.string(), z.unknown())),
});

export const likesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  const r = app.withTypeProvider<ZodTypeProvider>();

  // Always free. Visibility is a user preference, never paywalled.
  r.get(
    "/incoming",
    { schema: { response: { 200: incomingLikesResponseSchema } } },
    async (req) => {
      return listIncomingLikes(app.prisma, req.userId!);
    },
  );

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
