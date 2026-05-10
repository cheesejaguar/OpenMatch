import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  authorizedForConversation,
  listConversations,
  listMessages,
  postMessage,
} from "../services/chat.service.js";

const sendSchema = z.object({ body: z.string().min(1).max(2000) });

// In-memory subscriber map. Production scales this via Redis pub/sub;
// for MVP a single-instance map is acceptable.
const subscribers = new Map<string, Set<(msg: unknown) => void>>();

function publish(conversationId: string, msg: unknown) {
  const subs = subscribers.get(conversationId);
  if (!subs) return;
  for (const s of subs) {
    try {
      s(msg);
    } catch {
      // ignore broken consumer
    }
  }
}

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (req) => listConversations(app.prisma, req.userId!));

  app.get<{ Params: { conversationId: string } }>(
    "/:conversationId/messages",
    async (req, reply) => {
      const result = await listMessages(
        app.prisma,
        req.params.conversationId,
        req.userId!,
      );
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
        publish(req.params.conversationId, {
          type: "message",
          payload: msg,
        });
        return reply.send(msg);
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        return reply
          .code(e.statusCode ?? 500)
          .send({ error: e.message ?? "internal_error" });
      }
    },
  );

  // WebSocket for live message delivery.
  app.get<{ Params: { conversationId: string } }>(
    "/:conversationId/stream",
    { websocket: true } as never,
    async (connection, req) => {
      const conn = connection as unknown as {
        socket: {
          send: (m: string) => void;
          on: (ev: string, cb: () => void) => void;
        };
      };
      const userId = (req as { userId?: string }).userId;
      if (!userId) {
        conn.socket.send(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const ok = await authorizedForConversation(
        app.prisma,
        req.params.conversationId,
        userId,
      );
      if (!ok) {
        conn.socket.send(JSON.stringify({ error: "not_authorized" }));
        return;
      }
      const subscriber = (msg: unknown) => {
        conn.socket.send(JSON.stringify(msg));
      };
      const set =
        subscribers.get(req.params.conversationId) ??
        new Set<(m: unknown) => void>();
      set.add(subscriber);
      subscribers.set(req.params.conversationId, set);

      conn.socket.on("close", () => {
        set.delete(subscriber);
      });
    },
  );
};
