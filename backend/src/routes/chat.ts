import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { publishMessage } from "../lib/realtime.js";
import { listConversations, listMessages, postMessage } from "../services/chat.service.js";

const sendSchema = z.object({ body: z.string().min(1).max(2000) });

// PERF-B3 — keyset pagination query for GET /messages. `cursor` is a
// message id; the endpoint returns the page of messages strictly older
// than that cursor (the client supplies the oldest message id it has
// rendered to page backward through history).
const messagesQuerySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Live message fan-out is handled by Ably (see lib/realtime.ts). After a
// message is persisted we publish it on the `conversation:{id}` channel;
// clients subscribe directly to Ably using a token from /realtime/token.

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (req) => listConversations(app.prisma, req.userId!));

  app.get<{
    Params: { conversationId: string };
    Querystring: { cursor?: string; limit?: string };
  }>("/:conversationId/messages", async (req, reply) => {
    const { cursor, limit } = messagesQuerySchema.parse(req.query);
    const result = await listMessages(app.prisma, req.params.conversationId, req.userId!, {
      cursor,
      limit,
    });
    if (!result) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    // PERF-B3 — private cache header lets iOS short-circuit duplicate
    // re-fetches within a single screen entry without persisting the
    // response in any intermediary cache. The conversation list is
    // per-user so the body is never shareable.
    reply.header("cache-control", "private, no-cache");
    return result;
  });

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
        // chat service throws { statusCode: 4xx, message: "<code>" } for
        // validation-shaped failures (empty/oversize/not_participant).
        // Preserve the status + code; only fall back to internal_error
        // on a true unexpected throw.
        const e = err as { statusCode?: number; message?: string };
        const status = e.statusCode ?? 500;
        return reply.code(status).send({ error: e.message ?? ErrorCodes.INTERNAL_ERROR });
      }
    },
  );
};
