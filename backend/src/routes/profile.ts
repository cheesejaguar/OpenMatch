import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PUBLIC_PROFILE_SELECT } from "../lib/dto/peer-user.js";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import {
  ALLOWED_MIME_TYPES,
  deleteProfilePhoto,
  MAX_PHOTO_BYTES,
  uploadProfilePhoto,
} from "../lib/media.js";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  gender: z.string().min(1).max(40).optional(),
  pronouns: z.string().max(40).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  heightCm: z.number().int().min(120).max(230).optional(),
  educationLevel: z.string().max(60).optional(),
  college: z.string().max(120).optional(),
  jobTitle: z.string().max(120).optional(),
  companyDisplayEnabled: z.boolean().optional(),
  company: z.string().max(120).optional(),
  relationshipGoal: z.string().max(60).optional(),
  childrenStatus: z.string().max(60).optional(),
  familyPlans: z.string().max(60).optional(),
  drinking: z.string().max(60).optional(),
  smoking: z.string().max(60).optional(),
  cannabis: z.string().max(60).optional(),
  exercise: z.string().max(60).optional(),
  diet: z.string().max(60).optional(),
  religion: z.string().max(60).optional(),
  politics: z.string().max(60).optional(),
  languages: z.array(z.string().max(60)).max(20).optional(),
  interests: z.array(z.string().max(60)).max(30).optional(),
  prompts: z
    .array(
      z.object({
        question: z.string().min(1).max(200),
        answer: z.string().min(1).max(500),
      }),
    )
    .max(6)
    .optional(),
  visibilityStatus: z.enum(["visible", "hidden"]).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  declaredLocation: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  dateOfBirth: z.string().optional(), // ISO; only accepted at first onboarding
});

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/me", async (req, reply) => {
    const user = await app.prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        profile: { include: { photos: { orderBy: { sortOrder: "asc" } } } },
      },
    });
    if (!user) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    return user;
  });

  app.get("/me/profile", async (req, reply) => {
    let profile = await app.prisma.profile.findUnique({
      where: { userId: req.userId! },
      include: { photos: { orderBy: { sortOrder: "asc" } } },
    });
    if (!profile) {
      profile = await app.prisma.profile.create({
        data: {
          userId: req.userId!,
          displayName: "New user",
          gender: "PreferNotToSay",
        },
        include: { photos: true },
      });
    }
    return profile;
  });

  app.patch("/me/profile", async (req, reply) => {
    const body = updateSchema.parse(req.body);

    // Metro gate on profile edits — keeps a user from changing their
    // declared location to an out-of-cohort city after signup. If they
    // didn't send a declaredLocation we don't check.
    const declared = body.declaredLocation ?? body.location ?? null;
    if (declared) {
      const metro = await app.checkMetro(req, { location: declared });
      if (!metro.allow) {
        return sendHttpError(
          reply,
          httpError(ErrorCodes.OUTSIDE_METRO, {
            message:
              "OpenMatch is opening one metro at a time. Join the waitlist to be notified when we expand.",
            details: { nearestKm: metro.nearestKm },
          }),
        );
      }
    }

    if (body.dateOfBirth) {
      const dob = new Date(body.dateOfBirth);
      if (Number.isNaN(dob.getTime())) {
        return sendHttpError(reply, httpError(ErrorCodes.INVALID_DOB));
      }
      const age = Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
      if (age < 18) {
        return sendHttpError(reply, httpError(ErrorCodes.UNDERAGE));
      }
      await app.prisma.user.update({
        where: { id: req.userId! },
        data: { dateOfBirth: dob, isAgeVerified: true },
      });
    }

    const { location, declaredLocation: _declared, dateOfBirth: _ignored, ...data } = body;
    const profile = await app.prisma.profile.upsert({
      where: { userId: req.userId! },
      create: {
        userId: req.userId!,
        displayName: data.displayName ?? "New user",
        gender: (data.gender as never) ?? "PreferNotToSay",
        ...(data as Record<string, unknown>),
      } as never,
      update: data as never,
      include: { photos: { orderBy: { sortOrder: "asc" } } },
    });

    if (location) {
      await app.prisma.$executeRawUnsafe(
        `UPDATE "Profile" SET "location" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE "userId" = $3`,
        location.lng,
        location.lat,
        req.userId!,
      );
    }

    return profile;
  });

  // Server-mediated photo upload. iOS resizes/compresses the image on
  // device (target ≤ ~1.5MB JPEG) and POSTs the bytes as multipart. The
  // function streams the body into a buffer, calls Vercel Blob's `put()`,
  // and persists a ProfilePhoto row. Direct client→Blob uploads were
  // considered (handleUpload protocol) but rejected because the wire
  // format is browser-first and undocumented for non-browser clients.
  //
  // 4MB request body limit fits comfortably under Vercel's 4.5MB function
  // body cap and is more than enough for an on-device-downscaled JPEG.
  app.post(
    "/me/photos",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const profile = await app.prisma.profile.findUnique({
        where: { userId: req.userId! },
        select: { id: true, photos: { select: { id: true } } },
      });
      if (!profile) return sendHttpError(reply, httpError(ErrorCodes.PROFILE_NOT_FOUND));
      if (profile.photos.length >= 9) {
        return sendHttpError(reply, httpError(ErrorCodes.MAX_PHOTOS_REACHED));
      }

      const file = await req.file();
      if (!file) return sendHttpError(reply, httpError(ErrorCodes.NO_FILE));
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return sendHttpError(reply, httpError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE));
      }
      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_PHOTO_BYTES) {
        return sendHttpError(reply, httpError(ErrorCodes.PAYLOAD_TOO_LARGE));
      }

      try {
        const uploaded = await uploadProfilePhoto({
          profileId: profile.id,
          data: buffer,
          contentType: file.mimetype,
        });
        const photo = await app.prisma.profilePhoto.create({
          data: {
            profileId: profile.id,
            storageKey: uploaded.storageKey,
            cdnUrl: uploaded.cdnUrl,
            sortOrder: profile.photos.length,
          },
        });
        return reply.code(201).send(photo);
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        const status = e.statusCode ?? 500;
        // Preserve the original status when blob storage gave us a 4xx;
        // fall back to upload_failed otherwise.
        return reply.code(status).send({ error: e.message ?? ErrorCodes.UPLOAD_FAILED });
      }
    },
  );

  app.delete<{ Params: { photoId: string } }>("/me/photos/:photoId", async (req, reply) => {
    const profile = await app.prisma.profile.findUnique({
      where: { userId: req.userId! },
      select: { id: true },
    });
    if (!profile) return sendHttpError(reply, httpError(ErrorCodes.PROFILE_NOT_FOUND));

    const photo = await app.prisma.profilePhoto.findUnique({
      where: { id: req.params.photoId },
    });
    if (!photo || photo.profileId !== profile.id) {
      return sendHttpError(reply, httpError(ErrorCodes.PHOTO_NOT_FOUND));
    }

    // Hard-delete the underlying blob FIRST. If blob deletion fails we
    // still drop the DB row (orphan blobs are cheaper than orphan rows
    // pointing at content the user thinks they deleted) but log the
    // failure so the deletion-worker / on-call can reconcile.
    const blobResult = await deleteProfilePhoto(photo.storageKey, photo.cdnUrl);
    if (!blobResult.ok) {
      app.log.warn(
        {
          event: "media.blob_delete_failed",
          photoId: photo.id,
          storageKey: photo.storageKey,
          error: blobResult.error,
        },
        "blob_delete_failed",
      );
    }
    await app.prisma.profilePhoto.delete({ where: { id: photo.id } });

    // Compact the remaining photos' sort orders so the next upload's index
    // is always profile.photos.length.
    const remaining = await app.prisma.profilePhoto.findMany({
      where: { profileId: profile.id },
      orderBy: { sortOrder: "asc" },
    });
    await Promise.all(
      remaining.map((p, idx) =>
        p.sortOrder === idx
          ? Promise.resolve()
          : app.prisma.profilePhoto.update({ where: { id: p.id }, data: { sortOrder: idx } }),
      ),
    );

    return reply.code(204).send();
  });

  const reorderSchema = z.object({ photoIds: z.array(z.string()).min(1).max(9) });
  app.put("/me/photos/order", async (req, reply) => {
    const body = reorderSchema.parse(req.body);
    const profile = await app.prisma.profile.findUnique({
      where: { userId: req.userId! },
      select: { id: true, photos: { select: { id: true } } },
    });
    if (!profile) return sendHttpError(reply, httpError(ErrorCodes.PROFILE_NOT_FOUND));

    const owned = new Set(profile.photos.map((p) => p.id));
    if (body.photoIds.some((id) => !owned.has(id))) {
      return sendHttpError(reply, httpError(ErrorCodes.PHOTO_NOT_OWNED));
    }
    if (new Set(body.photoIds).size !== body.photoIds.length) {
      return sendHttpError(reply, httpError(ErrorCodes.DUPLICATE_PHOTOS));
    }

    await app.prisma.$transaction(
      body.photoIds.map((id, idx) =>
        app.prisma.profilePhoto.update({ where: { id }, data: { sortOrder: idx } }),
      ),
    );
    const photos = await app.prisma.profilePhoto.findMany({
      where: { profileId: profile.id },
      orderBy: { sortOrder: "asc" },
    });
    return reply.send(photos);
  });

  app.get<{ Params: { profileId: string } }>("/:profileId", async (req, reply) => {
    // SEV-A3: explicit `select` (PUBLIC_PROFILE_SELECT) excludes the
    // raw PostGIS `location` / `declaredLocation` geographies and the
    // internal moderation columns from the response. The previous
    // `include` returned every column including raw lat/lng.
    const profile = await app.prisma.profile.findUnique({
      where: { id: req.params.profileId },
      select: PUBLIC_PROFILE_SELECT,
    });
    if (!profile) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    if (profile.visibilityStatus === "hidden") {
      return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    }
    return profile;
  });
};
