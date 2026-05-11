import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const updateSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  gender: z.string().optional(),
  pronouns: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  heightCm: z.number().int().min(120).max(230).optional(),
  educationLevel: z.string().optional(),
  college: z.string().optional(),
  jobTitle: z.string().optional(),
  companyDisplayEnabled: z.boolean().optional(),
  company: z.string().optional(),
  relationshipGoal: z.string().optional(),
  childrenStatus: z.string().optional(),
  familyPlans: z.string().optional(),
  drinking: z.string().optional(),
  smoking: z.string().optional(),
  cannabis: z.string().optional(),
  exercise: z.string().optional(),
  diet: z.string().optional(),
  religion: z.string().optional(),
  politics: z.string().optional(),
  languages: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  prompts: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  visibilityStatus: z.enum(["visible", "hidden"]).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
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
