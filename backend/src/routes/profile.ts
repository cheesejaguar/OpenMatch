import type { Prisma } from "@prisma/client";
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

  // SEV-M8 — Explicit `select` instead of `include`. The previous shape
  // returned the entire User row to the client including:
  //   - `emailHash` / `phoneHash`  → hash + iOS keychain leak gives an
  //     attacker confirmation of what the backend stores about the user
  //   - `authSubject`              → Apple per-team stable id
  //   - raw `dateOfBirth`          → only age is needed client-side
  // Project to just what the iOS app actually displays / branches on.
  // Raw `dateOfBirth` is still available through `/me/full` for surfaces
  // (e.g. profile-edit) that need to render the date itself.
  app.get("/me", async (req, reply) => {
    const user = await app.prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        status: true,
        authProvider: true,
        isAgeVerified: true,
        isBanned: true,
        dateOfBirth: true,
        profile: {
          include: { photos: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    if (!user) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    // Derive age from DOB so callers don't need to do date math.
    const dob = user.dateOfBirth;
    const now = new Date();
    let age: number | null = null;
    if (dob) {
      age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
    }
    const { dateOfBirth: _dob, ...rest } = user;
    // PERF — `/profile/me` must always reflect fresh state (the user
    // just edited their bio, uploaded a photo, etc.) but private
    // intermediary caches must revalidate every request rather than
    // serving stale bytes.
    reply.header("cache-control", "private, max-age=0, must-revalidate");
    return { ...rest, age };
  });

  // `/me/full` — internal surface for the rare client screen that needs
  // the *raw* user row (e.g. an edit-profile flow that pre-fills the
  // DOB date-picker). Still gated by `authenticate` so the caller can
  // only ever read their own row. NOT exposed in the iOS API client
  // today; if a future iOS screen needs it, add the call there
  // explicitly so reviewers see the over-share.
  app.get("/me/full", async (req, reply) => {
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
    void _declared;
    void _ignored;
    // SEV-V1 — explicit allow-list of writable Profile columns. The
    // previous `...(data as Record<string, unknown>)` / `update: data
    // as never` cast escaped Prisma's generated types, so any future
    // column added to the Zod schema by mistake became user-writable.
    // Enumerating each field as a `Prisma.ProfileUpdateInput` makes
    // the Prisma type system the authoritative gate again.
    const updateData: Prisma.ProfileUpdateInput = {
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.bio !== undefined && { bio: data.bio }),
      ...(data.gender !== undefined && { gender: data.gender as never }),
      ...(data.pronouns !== undefined && { pronouns: data.pronouns }),
      ...(data.city !== undefined && { city: data.city }),
      ...(data.region !== undefined && { region: data.region }),
      ...(data.country !== undefined && { country: data.country }),
      ...(data.heightCm !== undefined && { heightCm: data.heightCm }),
      ...(data.educationLevel !== undefined && { educationLevel: data.educationLevel }),
      ...(data.college !== undefined && { college: data.college }),
      ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle }),
      ...(data.companyDisplayEnabled !== undefined && {
        companyDisplayEnabled: data.companyDisplayEnabled,
      }),
      ...(data.company !== undefined && { company: data.company }),
      ...(data.relationshipGoal !== undefined && {
        relationshipGoal: data.relationshipGoal as never,
      }),
      ...(data.childrenStatus !== undefined && { childrenStatus: data.childrenStatus }),
      ...(data.familyPlans !== undefined && { familyPlans: data.familyPlans }),
      ...(data.drinking !== undefined && { drinking: data.drinking }),
      ...(data.smoking !== undefined && { smoking: data.smoking }),
      ...(data.cannabis !== undefined && { cannabis: data.cannabis }),
      ...(data.exercise !== undefined && { exercise: data.exercise }),
      ...(data.diet !== undefined && { diet: data.diet }),
      ...(data.religion !== undefined && { religion: data.religion }),
      ...(data.politics !== undefined && { politics: data.politics }),
      ...(data.languages !== undefined && { languages: data.languages }),
      ...(data.interests !== undefined && { interests: data.interests }),
      ...(data.prompts !== undefined && { prompts: data.prompts as never }),
      ...(data.visibilityStatus !== undefined && { visibilityStatus: data.visibilityStatus }),
    };
    // Create-shape — Prisma's CreateInput requires the required
    // columns by literal value rather than the update-operation
    // wrappers, so we re-build the shape from the same allow-list
    // rather than spreading `updateData` (which has the wrapper
    // types).
    const createData: Prisma.ProfileCreateInput = {
      user: { connect: { id: req.userId! } },
      displayName: data.displayName ?? "New user",
      gender: (data.gender as never) ?? "PreferNotToSay",
      ...(data.bio !== undefined && { bio: data.bio }),
      ...(data.pronouns !== undefined && { pronouns: data.pronouns }),
      ...(data.city !== undefined && { city: data.city }),
      ...(data.region !== undefined && { region: data.region }),
      ...(data.country !== undefined && { country: data.country }),
      ...(data.heightCm !== undefined && { heightCm: data.heightCm }),
      ...(data.educationLevel !== undefined && { educationLevel: data.educationLevel }),
      ...(data.college !== undefined && { college: data.college }),
      ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle }),
      ...(data.companyDisplayEnabled !== undefined && {
        companyDisplayEnabled: data.companyDisplayEnabled,
      }),
      ...(data.company !== undefined && { company: data.company }),
      ...(data.relationshipGoal !== undefined && {
        relationshipGoal: data.relationshipGoal as never,
      }),
      ...(data.childrenStatus !== undefined && { childrenStatus: data.childrenStatus }),
      ...(data.familyPlans !== undefined && { familyPlans: data.familyPlans }),
      ...(data.drinking !== undefined && { drinking: data.drinking }),
      ...(data.smoking !== undefined && { smoking: data.smoking }),
      ...(data.cannabis !== undefined && { cannabis: data.cannabis }),
      ...(data.exercise !== undefined && { exercise: data.exercise }),
      ...(data.diet !== undefined && { diet: data.diet }),
      ...(data.religion !== undefined && { religion: data.religion }),
      ...(data.politics !== undefined && { politics: data.politics }),
      ...(data.languages !== undefined && { languages: data.languages }),
      ...(data.interests !== undefined && { interests: data.interests }),
      ...(data.prompts !== undefined && { prompts: data.prompts as never }),
      ...(data.visibilityStatus !== undefined && { visibilityStatus: data.visibilityStatus }),
    };
    const profile = await app.prisma.profile.upsert({
      where: { userId: req.userId! },
      create: createData,
      update: updateData,
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
    // PERF — peer profile pages are fetched repeatedly while a user
    // reads them, but they DO mutate (display name edit, new photo).
    // A short 60s freshness with 2 minutes of stale-while-revalidate
    // keeps repeated taps on the same profile from re-hitting Prisma.
    reply.header("cache-control", "private, max-age=60, stale-while-revalidate=120");
    return profile;
  });
};
