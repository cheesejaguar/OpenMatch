import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import users from "../../matching/fixtures/synthetic-users.json" with { type: "json" };

interface RawUser {
  id: string;
  displayName: string;
  age: number;
  gender: string;
  lat: number;
  lng: number;
  city: string;
  relationshipGoal: string;
  interests: string[];
  interestedInGenders: string[];
  ageRange: [number, number];
  lastActiveHoursAgo: number;
  moderationStatus: string;
}

const adapter = new PrismaPg(process.env.DATABASE_URL ?? "");
const prisma = new PrismaClient({ adapter });

function dobForAge(years: number, today = new Date()): Date {
  const d = new Date(today);
  d.setFullYear(d.getFullYear() - years);
  return d;
}

async function main() {
  console.log("Seeding synthetic users…");
  for (const raw of (users as { users: RawUser[] }).users) {
    const emailHash = `seed-${raw.id}@openmatch.local`;
    const existing = await prisma.user.findUnique({
      where: { id: raw.id },
    });
    if (existing) continue;

    const user = await prisma.user.create({
      data: {
        id: raw.id,
        dateOfBirth: dobForAge(raw.age),
        emailHash,
        authProvider: "dev",
        isAgeVerified: true,
      },
    });

    await prisma.profile.create({
      data: {
        userId: user.id,
        displayName: raw.displayName,
        bio: `Hi, I'm ${raw.displayName}. I enjoy ${raw.interests.slice(0, 3).join(", ")}.`,
        gender: raw.gender as never,
        city: raw.city,
        region: "CA",
        country: "US",
        relationshipGoal: raw.relationshipGoal as never,
        interests: raw.interests,
        prompts: [
          { question: "A perfect Sunday looks like…", answer: "coffee, a walk, and good food." },
        ],
        lastActiveAt: new Date(Date.now() - raw.lastActiveHoursAgo * 3_600_000),
        moderationStatus: raw.moderationStatus as never,
      },
    });

    await prisma.preferences.create({
      data: {
        userId: user.id,
        minAge: raw.ageRange[0],
        maxAge: raw.ageRange[1],
        maxDistanceKm: 40,
        interestedGenders: raw.interestedInGenders as never,
      },
    });

    // Stub photo so profiles have an image; storageKey points at a
    // placeholder served by /media/ when no GCS is configured.
    await prisma.profilePhoto.create({
      data: {
        profileId: (await prisma.profile.findUnique({
          where: { userId: user.id },
        }))!.id,
        storageKey: `seed/${raw.id}.jpg`,
        cdnUrl: `/media/seed/${raw.id}.jpg`,
        sortOrder: 0,
      },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "Profile" SET "location" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE "userId" = $3`,
      raw.lng,
      raw.lat,
      user.id,
    );
  }

  // Wire one pre-existing like so the demo user (u001) has someone in
  // their Likes tab on first open.
  const existing = await prisma.like.findFirst({
    where: { fromUserId: "u002", toUserId: "u001" },
  });
  if (!existing) {
    await prisma.like.create({
      data: { fromUserId: "u002", toUserId: "u001", status: "active" },
    });
  }

  console.log("Seed complete.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
