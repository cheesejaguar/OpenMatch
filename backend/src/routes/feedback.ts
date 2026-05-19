import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const feedbackSchema = z.object({
  category: z.enum(["bug", "suggestion", "praise", "other"]),
  body: z.string().min(1).max(8000),
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(40).optional(),
  deviceModel: z.string().max(80).optional(),
});

// In-app beta-tester feedback. iOS Settings → "Send feedback" posts
// here with the device + app version pre-filled. The admin /feedback
// surface (see routes/admin/feedback.ts) is where moderators triage
// the queue.

export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = feedbackSchema.parse(req.body);
      const row = await app.prisma.betaFeedback.create({
        data: {
          userId: req.userId ?? null,
          category: body.category,
          body: body.body,
          appVersion: body.appVersion ?? null,
          osVersion: body.osVersion ?? null,
          deviceModel: body.deviceModel ?? null,
        },
      });
      return reply.send({ id: row.id, createdAt: row.createdAt.toISOString() });
    },
  );
};
