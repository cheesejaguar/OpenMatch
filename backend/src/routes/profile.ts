import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  ALLOWED_MIME_TYPES,
  MAX_PHOTO_BYTES,
  deleteProfilePhoto,
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
    if (!user) return reply.code(404).send({ error: "not_found" });
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

    if (body.dateOfBirth) {
      const dob = new Date(body.dateOfBirth);
      if (Number.isNaN(dob.getTime())) {
        return reply.code(400).send({ error: "invalid_dob" });
      }
      const age = Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
      if (age < 18) {
        return reply.code(403).send({ error: "underage" });
      }
      await app.prisma.user.update({
        where: { id: req.userId! },
        data: { dateOfBirth: dob, isAgeVerified: true },
      });
    }

    const { location, dateOfBirth: _ignored, ...data } = body;
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
      if (!profile) return reply.code(404).send({ error: "profile_not_found" });
      if (profile.photos.length >= 9) {
        return reply.code(400).send({ error: "max_photos_reached" });
      }

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "no_file" });
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return reply.code(415).send({ error: "unsupported_media_type" });
      }
      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_PHOTO_BYTES) {
        return reply.code(413).send({ error: "payload_too_large" });
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
        return reply.code(e.statusCode ?? 500).send({ error: e.message ?? "upload_failed" });
      }
    },
  );

  app.delete<{ Params: { photoId: string } }>("/me/photos/:photoId", async (req, reply) => {
    const profile = await app.prisma.profile.findUnique({
      where: { userId: req.userId! },
      select: { id: true },
    });
    if (!profile) return reply.code(404).send({ error: "profile_not_found" });

    const photo = await app.prisma.profilePhoto.findUnique({
      where: { id: req.params.photoId },
    });
    if (!photo || photo.profileId !== profile.id) {
      return reply.code(404).send({ error: "photo_not_found" });
    }

    await deleteProfilePhoto(photo.storageKey, photo.cdnUrl);
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
    if (!profile) return reply.code(404).send({ error: "profile_not_found" });

    const owned = new Set(profile.photos.map((p) => p.id));
    if (body.photoIds.some((id) => !owned.has(id))) {
      return reply.code(400).send({ error: "photo_not_owned" });
    }
    if (new Set(body.photoIds).size !== body.photoIds.length) {
      return reply.code(400).send({ error: "duplicate_photos" });
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
    const profile = await app.prisma.profile.findUnique({
      where: { id: req.params.profileId },
      include: { photos: { orderBy: { sortOrder: "asc" } } },
    });
    if (!profile) return reply.code(404).send({ error: "not_found" });
    if (profile.visibilityStatus === "hidden") return reply.code(404).send({ error: "not_found" });
    return profile;
  });
};
