import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { fetchPhotoBytes } from "../lib/media.js";
import { signPhotoToken, verifyPhotoToken } from "../lib/photo-tokens.js";
import { authorizePhotoAccess } from "../services/photo-access.service.js";

// Photo URL/serve endpoints (SEV-N16 / SEV-M7).
//
// Two endpoints split the read path so authorization is re-checked at
// every request, not just at the time the URL was minted:
//
//   GET /api/v1/photos/:id/url
//     - Authenticated. Performs the owner / matched / not-blocked check.
//     - Returns { url, expiresAt } where `url` points at /serve below
//       and carries a short-lived HMAC token bound to (photoId, requester).
//
//   GET /api/v1/photos/:id/serve?token=...
//     - Validates the HMAC token (no DB hit) and re-reads the photo row,
//       then streams bytes back. Re-checking the row guards against a
//       revoked / removed photo whose token was issued seconds before.
//
// The serve endpoint is intentionally NOT behind app.authenticate — the
// signed token IS the credential, so this URL works in `<img src=…>` and
// pre-fetch caches without needing the bearer JWT header. The token is
// audience-scoped to a specific user so leaking it doesn't help anyone
// else: a token minted for user A only succeeds when re-presented for
// the same photo + same requester.

const PHOTO_URL_TTL_SECONDS = 300; // 5 minutes

const urlSchema = z.object({ photoId: z.string().min(1).max(64) });

export const photosRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { photoId: string } }>(
    "/:photoId/url",
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { photoId } = urlSchema.parse(req.params);
      const requesterUserId = req.userId!;

      const result = await authorizePhotoAccess(app.prisma, {
        photoId,
        requesterUserId,
      });
      if (!result.ok) {
        if (result.reason === "not_found") {
          return sendHttpError(reply, httpError(ErrorCodes.PHOTO_NOT_FOUND));
        }
        return sendHttpError(reply, httpError(ErrorCodes.FORBIDDEN));
      }

      const token = signPhotoToken(
        { photoId: result.photo.id, audienceUserId: requesterUserId },
        { ttlSeconds: PHOTO_URL_TTL_SECONDS },
      );
      const expiresAt = new Date(Date.now() + PHOTO_URL_TTL_SECONDS * 1000);
      // Relative URL so the iOS client can prefix its configured base
      // host — the same value used for every other /api/v1 endpoint.
      const url = `/api/v1/photos/${encodeURIComponent(result.photo.id)}/serve?token=${encodeURIComponent(token)}&aud=${encodeURIComponent(requesterUserId)}`;
      return reply.send({
        url,
        expiresAt: expiresAt.toISOString(),
      });
    },
  );

  // The serve endpoint is NOT authenticated — the signed token is the
  // credential. We extract the requesting user id from the `aud` query
  // param so we can re-verify the token + re-do the access check.
  app.get<{
    Params: { photoId: string };
    Querystring: { token?: string; aud?: string };
  }>(
    "/:photoId/serve",
    {
      // The serve endpoint can be hot — iOS may request 6-9 thumbnails per
      // match list refresh. Bump the per-IP cap accordingly.
      config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const photoId = req.params.photoId;
      const tokenStr = req.query?.token;
      const audStr = req.query?.aud ?? "";
      if (!tokenStr) {
        return sendHttpError(reply, httpError(ErrorCodes.PHOTO_URL_TOKEN_INVALID));
      }
      const audienceUserId = audStr === "" ? null : audStr;
      const verifyResult = verifyPhotoToken(tokenStr, {
        photoId,
        audienceUserId,
      });
      if (!verifyResult.ok) {
        if (verifyResult.reason === "expired") {
          return sendHttpError(reply, httpError(ErrorCodes.PHOTO_URL_TOKEN_EXPIRED));
        }
        return sendHttpError(reply, httpError(ErrorCodes.PHOTO_URL_TOKEN_INVALID));
      }

      // Re-authorize against the live DB state. The token proves the
      // requester was authorized at mint time; we re-check here so a
      // user who got blocked / unmatched within the 5-minute window
      // loses access at the next image fetch.
      if (audienceUserId) {
        const access = await authorizePhotoAccess(app.prisma, {
          photoId,
          requesterUserId: audienceUserId,
        });
        if (!access.ok) {
          return sendHttpError(reply, httpError(ErrorCodes.PHOTO_NOT_FOUND));
        }
        const bytes = await fetchPhotoBytes(access.photo.storageKey, access.photo.cdnUrl);
        if (!bytes) {
          return sendHttpError(reply, httpError(ErrorCodes.PHOTO_NOT_FOUND));
        }
        // Short browser cache (5 min) — keeps the image hot across a list
        // refresh but limits how long a revoked URL keeps rendering.
        reply.header("cache-control", "private, max-age=300");
        reply.header("content-type", bytes.contentType);
        return reply.send(bytes.bytes);
      }

      // Admin-context / unauthenticated path. Load the photo without
      // relational checks. Used by admin moderation queues that mint
      // tokens with audienceUserId=null.
      const row = await app.prisma.profilePhoto.findUnique({
        where: { id: photoId },
        select: { id: true, storageKey: true, cdnUrl: true },
      });
      if (!row) {
        return sendHttpError(reply, httpError(ErrorCodes.PHOTO_NOT_FOUND));
      }
      const bytes = await fetchPhotoBytes(row.storageKey, row.cdnUrl);
      if (!bytes) {
        return sendHttpError(reply, httpError(ErrorCodes.PHOTO_NOT_FOUND));
      }
      reply.header("cache-control", "private, max-age=300");
      reply.header("content-type", bytes.contentType);
      return reply.send(bytes.bytes);
    },
  );
};
