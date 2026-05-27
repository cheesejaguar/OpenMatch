import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { listPendingDateFeedback, submitDateFeedback } from "../services/date-feedback.service.js";

// Post-match outcome + two-sided feedback (#1/#11). Private to the author.
const submitSchema = z.object({
  met: z.boolean(),
  wantToContinue: z.boolean().optional(),
  respectful: z.boolean().optional(),
  matchedProfile: z.boolean().optional(),
  note: z.string().max(1000).optional(),
});

export const dateFeedbackRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/pending", async (req, reply) => {
    const items = await listPendingDateFeedback(app.prisma, req.userId!);
    reply.header("cache-control", "private, max-age=0, must-revalidate");
    return { items };
  });

  app.post<{ Params: { matchId: string } }>("/:matchId", async (req, reply) => {
    const body = submitSchema.parse(req.body);
    try {
      const row = await submitDateFeedback({
        prisma: app.prisma,
        matchId: req.params.matchId,
        fromUserId: req.userId!,
        ...body,
      });
      return reply.send({ id: row.id, matchId: row.matchId });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 404) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      if (e.statusCode === 403) return sendHttpError(reply, httpError(ErrorCodes.NOT_PARTICIPANT));
      throw err;
    }
  });
};
