import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { publishConversationEvent } from "../lib/realtime.js";
import { addReaction, removeReaction } from "../services/chat.service.js";

// Message-scoped routes. Currently just emoji reactions; isolated from
// chat.ts because the natural URL shape (`/api/v1/messages/:id/...`) is
// outside the `/api/v1/conversations` prefix that chat.ts mounts under.

const emojiSchema = z.object({
  // 64-char cap matches the service layer's bound; covers every grapheme
  // cluster + skin-tone / ZWJ joiner sequence we expect to see.
  emoji: z.string().min(1).max(64),
});

export const messagesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post<{ Params: { messageId: string } }>(
    "/:messageId/reactions",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = emojiSchema.parse(req.body);
      const result = await addReaction(app.prisma, {
        messageId: req.params.messageId,
        userId: req.userId!,
        emoji: body.emoji,
      });
      if (!result.ok) {
        if (result.reason === "not_found") {
          return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
        }
        if (result.reason === "invalid_emoji") {
          return sendHttpError(reply, httpError(ErrorCodes.INVALID_PAYLOAD));
        }
        return sendHttpError(reply, httpError(ErrorCodes.FORBIDDEN));
      }
      await publishConversationEvent(result.conversationId, "reaction.added", {
        messageId: result.messageId,
        userId: result.userId,
        emoji: result.emoji,
      });
      return reply.code(201).send({
        messageId: result.messageId,
        userId: result.userId,
        emoji: result.emoji,
      });
    },
  );

  // DELETE with an emoji in the query because Fastify's body-parser is
  // picky about DELETE bodies and HTTP semantics treat them as undefined.
  app.delete<{
    Params: { messageId: string };
    Querystring: { emoji?: string };
  }>(
    "/:messageId/reactions",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const emoji = req.query?.emoji;
      if (!emoji || emoji.length > 64) {
        return sendHttpError(reply, httpError(ErrorCodes.INVALID_PAYLOAD));
      }
      const result = await removeReaction(app.prisma, {
        messageId: req.params.messageId,
        userId: req.userId!,
        emoji,
      });
      if (!result.ok) {
        if (result.reason === "not_found") {
          return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
        }
        return sendHttpError(reply, httpError(ErrorCodes.FORBIDDEN));
      }
      await publishConversationEvent(result.conversationId, "reaction.removed", {
        messageId: result.messageId,
        userId: result.userId,
        emoji: result.emoji,
      });
      return reply.send({
        messageId: result.messageId,
        userId: result.userId,
        emoji: result.emoji,
      });
    },
  );
};
