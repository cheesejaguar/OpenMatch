import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const tokenSchema = z.object({
  platform: z.enum(["ios"]),
  token: z.string().min(1).max(512),
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(40).optional(),
});

// Push-notification device registration. iOS posts its raw APNs token
// here after a successful `application:didRegisterForRemoteNotifications`
// callback. We upsert on (userId, token) so a re-install or token
// rotation updates `lastSeenAt` rather than producing duplicates.

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/device-token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = tokenSchema.parse(req.body);
      await app.prisma.notificationDevice.upsert({
        where: {
          userId_token: { userId: req.userId!, token: body.token },
        },
        create: {
          userId: req.userId!,
          platform: body.platform,
          token: body.token,
          appVersion: body.appVersion ?? null,
          osVersion: body.osVersion ?? null,
        },
        update: {
          appVersion: body.appVersion ?? undefined,
          osVersion: body.osVersion ?? undefined,
          lastSeenAt: new Date(),
        },
      });
      return reply.send({ ok: true });
    },
  );
};
