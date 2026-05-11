import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { publishMessage } from "../lib/realtime.js";
import { listConversations, listMessages, postMessage } from "../services/chat.service.js";

const sendSchema = z.object({ body: z.string().min(1).max(2000) });

// Live message fan-out is handled by Ably (see lib/realtime.ts). After a
// message is persisted we publish it on the `conversation:{id}` channel;
// clients subscribe directly to Ably using a token from /realtime/token.

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (req) => listConversations(app.prisma, req.userId!));

  app.get<{ Params: { conversationId: string } }>(
    "/:conversationId/messages",
    async (req, reply) => {
      const result = await listMessages(app.prisma, req.params.conversationId, req.userId!);
      if (!result) return reply.code(404).send({ error: "not_found" });
      return result;
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/:conversationId/messages",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = sendSchema.parse(req.body);
      try {
        const msg = await postMessage(
          app.prisma,
          req.params.conversationId,
          req.userId!,
          body.body,
        );
        await publishMessage(req.params.conversationId, { type: "message", payload: msg });
        return reply.send(msg);
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "internal_error" });
      }
    },
  );
};
