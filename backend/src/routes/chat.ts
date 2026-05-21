import { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  fetchAudioStream,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  uploadVoiceNote,
} from "../lib/media.js";
import { publishConversationEvent, publishMessage } from "../lib/realtime.js";
import {
  authorizedForConversation,
  listConversations,
  listMessages,
  markConversationAsRead,
  markMessageAsRead,
  postAudioMessage,
  postMessage,
} from "../services/chat.service.js";
import { buildSuggestedOpeners } from "../services/suggested-openers.service.js";

const sendSchema = z.object({ body: z.string().min(1).max(2000) });

// PERF-B3 — keyset pagination query for GET /messages. `cursor` is a
// message id; the endpoint returns the page of messages strictly older
// than that cursor (the client supplies the oldest message id it has
// rendered to page backward through history).
const messagesQuerySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// PERF-B16 / PERF-X4 — response schema for GET /messages so Fastify
// routes serialisation through fast-json-stringify (typically 5-10x
// faster than the default JSON.stringify path) and strips any field
// MESSAGE_LIST_SELECT didn't materialise.
const messageRowSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderUserId: z.string(),
  body: z.string(),
  createdAt: z.coerce.date(),
  deliveredAt: z.coerce.date().nullable(),
  readAt: z.coerce.date().nullable(),
  moderationStatus: z.string(),
  audioPath: z.string().nullable(),
  audioDurationMs: z.number().int().nullable(),
  reactions: z.array(
    z.object({
      userId: z.string(),
      emoji: z.string(),
      createdAt: z.coerce.date(),
    }),
  ),
});
const messagesResponseSchema = z.array(messageRowSchema);

// Live message fan-out is handled by Ably (see lib/realtime.ts). After a
// message is persisted we publish it on the `conversation:{id}` channel;
// clients subscribe directly to Ably using a token from /realtime/token.

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/", async (req) => listConversations(app.prisma, req.userId!));

  r.get(
    "/:conversationId/messages",
    {
      schema: {
        params: z.object({ conversationId: z.string() }),
        querystring: messagesQuerySchema,
        response: { 200: messagesResponseSchema },
      },
    },
    async (req, reply) => {
      const { cursor, limit } = req.query;
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
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    "/:conversationId/suggested-openers",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const result = await buildSuggestedOpeners(
        app.prisma,
        req.params.conversationId,
        req.userId!,
      );
      if (!result) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      reply.header("cache-control", "private, no-cache");
      return reply.send(result);
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

  // Read receipts. The recipient calls this when they open the
  // conversation; we mark every message they didn't send as read in one
  // round-trip and fan out a `read` event over Ably so the sender can
  // flip "Delivered" → "Read at HH:mm" without polling.
  app.post<{ Params: { conversationId: string } }>(
    "/:conversationId/read",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const result = await markConversationAsRead(app.prisma, {
        conversationId: req.params.conversationId,
        readerUserId: req.userId!,
      });
      if (!result.ok) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      if (result.updated > 0) {
        await publishConversationEvent(req.params.conversationId, "read", {
          conversationId: req.params.conversationId,
          readerUserId: req.userId!,
          readAt: new Date().toISOString(),
        });
      }
      return reply.send({ updated: result.updated });
    },
  );

  // Per-message read receipt — kept as a granular variant for clients
  // that want to ack a single message (e.g. a notification action
  // tapped from the lock screen).
  app.post<{ Params: { conversationId: string; messageId: string } }>(
    "/:conversationId/messages/:messageId/read",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const result = await markMessageAsRead(app.prisma, {
        messageId: req.params.messageId,
        readerUserId: req.userId!,
      });
      if (!result.ok) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      await publishConversationEvent(req.params.conversationId, "read", {
        conversationId: req.params.conversationId,
        readerUserId: req.userId!,
        readAt: (result.readAt ?? new Date()).toISOString(),
        messageId: req.params.messageId,
      });
      return reply.send({ readAt: result.readAt });
    },
  );

  // Voice-note upload. multipart/form-data with a single `audio` part
  // (or `file` — we accept either name to stay compatible with the
  // photo upload's `file` convention) plus a `durationMs` form field.
  app.post<{ Params: { conversationId: string } }>(
    "/:conversationId/messages/audio",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const conversationId = req.params.conversationId;
      if (!(await authorizedForConversation(app.prisma, conversationId, req.userId!))) {
        return sendHttpError(reply, httpError(ErrorCodes.NOT_PARTICIPANT));
      }

      // fastify-multipart parses both file + non-file parts; we read the
      // first file part and inspect its sibling fields. The duration is
      // sent by the client (AVFoundation knows the recording length down
      // to the millisecond at stop-record time) and validated against
      // MAX_AUDIO_DURATION_MS server-side so a misbehaving client can't
      // claim a 5-second note for a 60-second file.
      const file = await req.file();
      if (!file) return sendHttpError(reply, httpError(ErrorCodes.NO_FILE));
      if (!ALLOWED_AUDIO_MIME_TYPES.has(file.mimetype)) {
        return sendHttpError(reply, httpError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE));
      }
      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_AUDIO_BYTES) {
        return sendHttpError(reply, httpError(ErrorCodes.PAYLOAD_TOO_LARGE));
      }

      // Duration comes through as a multipart field; fastify-multipart
      // exposes those via `file.fields` once `file()` has consumed the
      // file part. Default to 0 so a missing field doesn't crash; we
      // still bound it below.
      const fields = (file.fields ?? {}) as Record<string, { value?: string } | undefined>;
      const rawDuration = fields.durationMs?.value ?? "0";
      const durationMs = Math.max(0, Math.floor(Number(rawDuration) || 0));
      if (durationMs <= 0 || durationMs > MAX_AUDIO_DURATION_MS) {
        return sendHttpError(reply, httpError(ErrorCodes.INVALID_PAYLOAD));
      }

      try {
        const uploaded = await uploadVoiceNote({
          conversationId,
          data: buffer,
          contentType: file.mimetype,
        });
        const msg = await postAudioMessage(app.prisma, conversationId, req.userId!, {
          audioPath: uploaded.storageKey,
          audioCdnUrl: uploaded.cdnUrl,
          audioDurationMs: durationMs,
        });
        // Strip the server-only cdnUrl before publishing/returning;
        // clients only ever see `audioPath` + `audioDurationMs` and
        // fetch the bytes via /audio/url -> /audio/serve.
        const { audioCdnUrl: _omit, ...publicMsg } = msg;
        void _omit;
        await publishMessage(conversationId, { type: "message", payload: publicMsg });
        return reply.code(201).send(publicMsg);
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        const status = e.statusCode ?? 500;
        return reply.code(status).send({ error: e.message ?? ErrorCodes.UPLOAD_FAILED });
      }
    },
  );

  // Signed URL for a voice-note attached to a message. Mirrors the
  // photos /url + /serve split: this endpoint is the authenticated
  // gate that picks up the access decision, then the bytes flow over
  // the unauthenticated /serve endpoint with a short-lived signature.
  //
  // We sidestep minting a separate JWT for audio by re-using the
  // photo-token signer; the audience is the requester, the photoId
  // slot carries the messageId. The serve endpoint re-verifies the
  // token + re-reads the message row so a user who got unmatched
  // after the URL was minted loses access at the next fetch.
  app.get<{ Params: { messageId: string } }>(
    "/messages/:messageId/audio/url",
    {
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const message = await app.prisma.message.findUnique({
        where: { id: req.params.messageId },
        select: {
          id: true,
          conversationId: true,
          audioPath: true,
          senderUserId: true,
        },
      });
      if (!message || !message.audioPath) {
        return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      }
      if (!(await authorizedForConversation(app.prisma, message.conversationId, req.userId!))) {
        return sendHttpError(reply, httpError(ErrorCodes.FORBIDDEN));
      }
      const { signPhotoToken } = await import("../lib/photo-tokens.js");
      const token = signPhotoToken(
        { photoId: message.id, audienceUserId: req.userId! },
        { ttlSeconds: 300 },
      );
      const url = `/api/v1/conversations/messages/${encodeURIComponent(message.id)}/audio/serve?token=${encodeURIComponent(token)}&aud=${encodeURIComponent(req.userId!)}`;
      return reply.send({
        url,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
    },
  );

  // Token-gated audio stream. NOT behind authenticate — the signed token
  // is the credential, exactly like /photos/:id/serve.
  app.get<{
    Params: { messageId: string };
    Querystring: { token?: string; aud?: string };
  }>(
    "/messages/:messageId/audio/serve",
    {
      config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const tokenStr = req.query?.token;
      const audStr = req.query?.aud ?? "";
      if (!tokenStr || !audStr) {
        return sendHttpError(reply, httpError(ErrorCodes.PHOTO_URL_TOKEN_INVALID));
      }
      const { verifyPhotoToken } = await import("../lib/photo-tokens.js");
      const v = verifyPhotoToken(tokenStr, {
        photoId: req.params.messageId,
        audienceUserId: audStr,
      });
      if (!v.ok) {
        if (v.reason === "expired") {
          return sendHttpError(reply, httpError(ErrorCodes.PHOTO_URL_TOKEN_EXPIRED));
        }
        return sendHttpError(reply, httpError(ErrorCodes.PHOTO_URL_TOKEN_INVALID));
      }
      const message = await app.prisma.message.findUnique({
        where: { id: req.params.messageId },
        select: {
          conversationId: true,
          audioPath: true,
          audioCdnUrl: true,
        },
      });
      if (!message || !message.audioPath || !message.audioCdnUrl) {
        return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      }
      if (!(await authorizedForConversation(app.prisma, message.conversationId, audStr))) {
        return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      }
      const rangeHeader = req.headers.range;
      const stream = await fetchAudioStream(message.audioPath, message.audioCdnUrl, {
        range: typeof rangeHeader === "string" ? rangeHeader : undefined,
      });
      if (!stream) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      reply.header("cache-control", "private, max-age=300");
      reply.header("content-type", stream.contentType);
      if (stream.contentLength !== null) {
        reply.header("content-length", String(stream.contentLength));
      }
      if (stream.acceptRanges) {
        reply.header("accept-ranges", stream.acceptRanges);
      }
      if (stream.status === 206) reply.code(206);
      return reply.send(Readable.fromWeb(stream.body as never));
    },
  );
};
