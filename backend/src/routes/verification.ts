import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { ALLOWED_MIME_TYPES, MAX_PHOTO_BYTES } from "../lib/media.js";
import {
  startSelfieVerification,
  submitSelfieVerification,
} from "../services/verification.service.js";

// Trust & safety automation — user-initiated verification endpoints.
//
// `/start` returns a fresh pose challenge; `/submit` accepts the
// resulting selfie. Both routes are rate-limited so an attacker can't
// burn through challenge nonces.

export const verificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post(
    "/selfie/start",
    { config: { rateLimit: { max: 6, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      const result = await startSelfieVerification({
        prisma: app.prisma,
        userId: req.userId!,
      });
      return reply.send(result);
    },
  );

  app.post(
    "/selfie",
    { config: { rateLimit: { max: 6, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      const file = await req.file();
      if (!file) return sendHttpError(reply, httpError(ErrorCodes.NO_FILE));
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return sendHttpError(reply, httpError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE));
      }
      const nonceField = file.fields?.challengeNonce as { value?: string } | undefined;
      const nonce = nonceField?.value;
      if (!nonce || typeof nonce !== "string") {
        return sendHttpError(reply, httpError(ErrorCodes.INVALID_PAYLOAD));
      }
      const parsedNonce = z.string().min(1).max(64).safeParse(nonce);
      if (!parsedNonce.success) {
        return sendHttpError(reply, httpError(ErrorCodes.INVALID_PAYLOAD));
      }
      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_PHOTO_BYTES) {
        return sendHttpError(reply, httpError(ErrorCodes.PAYLOAD_TOO_LARGE));
      }
      try {
        const r = await submitSelfieVerification({
          prisma: app.prisma,
          userId: req.userId!,
          challengeNonce: parsedNonce.data,
          imageBytes: buffer,
          contentType: file.mimetype,
        });
        if (!r.ok) {
          if (r.reason === "challenge_not_found") {
            return sendHttpError(reply, httpError(ErrorCodes.CHALLENGE_NOT_FOUND));
          }
          if (r.reason === "challenge_used") {
            return sendHttpError(reply, httpError(ErrorCodes.CHALLENGE_USED));
          }
          return sendHttpError(reply, httpError(ErrorCodes.INVALID_REQUEST));
        }
        return reply.code(202).send({
          requestId: r.requestId,
          status: "pending_review",
        });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        const status = e.statusCode ?? 500;
        return reply.code(status).send({ error: e.message ?? ErrorCodes.UPLOAD_FAILED });
      }
    },
  );

  app.get("/me", async (req, reply) => {
    const rows = await app.prisma.verificationRequest.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        kind: true,
        status: true,
        challengePrompt: true,
        createdAt: true,
        reviewedAt: true,
      },
    });
    return reply.send({ requests: rows });
  });
};
