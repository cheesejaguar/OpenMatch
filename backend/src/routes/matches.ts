import type { FastifyPluginAsync } from "fastify";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { listMatches, unmatch } from "../services/match.service.js";

export const matchesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (req) => listMatches(app.prisma, req.userId!));

  app.get<{ Params: { matchId: string } }>("/:matchId", async (req, reply) => {
    const m = await app.prisma.match.findUnique({
      where: { id: req.params.matchId },
      include: {
        userA: { include: { profile: { include: { photos: true } } } },
        userB: { include: { profile: { include: { photos: true } } } },
        conversation: true,
      },
    });
    if (!m) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    if (m.userAId !== req.userId! && m.userBId !== req.userId!) {
      return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    }
    return m;
  });

  app.post<{ Params: { matchId: string } }>("/:matchId/unmatch", async (req, reply) => {
    const result = await unmatch(app.prisma, req.params.matchId, req.userId!);
    if (!result.unmatched) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    return reply.send(result);
  });
};
