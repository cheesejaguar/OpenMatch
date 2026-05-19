import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";

// Batched analytics event sink. iOS debounces events client-side and
// posts in batches of up to 50; we persist each one with the user
// id from the session. Anonymous events are rejected — the analytics
// schema in REPORT_CARD.md ties every event to a cohort, and we
// don't want to receive untracable noise.

const eventSchema = z.object({
  name: z.string().min(1).max(120),
  properties: z.record(z.string(), z.unknown()).optional(),
  clientTs: z.string().datetime().optional(),
  sessionId: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(40).optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/event",
    { config: { rateLimit: { max: 200, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = batchSchema.parse(req.body);
      const userId = req.userId;
      if (!userId) {
        // Anonymous events explicitly rejected (see file header).
        return sendHttpError(reply, httpError(ErrorCodes.UNAUTHORIZED));
      }
      const data = body.events.map((e) => ({
        userId,
        eventName: e.name,
        properties: (e.properties ?? null) as never,
        clientTs: e.clientTs ? new Date(e.clientTs) : null,
        sessionId: e.sessionId ?? null,
        appVersion: e.appVersion ?? null,
        osVersion: e.osVersion ?? null,
      }));
      const result = await app.prisma.analyticsEvent.createMany({
        data: data as never,
      });
      return reply.send({ accepted: result.count });
    },
  );
};
