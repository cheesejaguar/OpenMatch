import { PrismaClient } from "@prisma/client";

// Integration tests run against a real Postgres + PostGIS database. CI
// provisions a service container; locally point DATABASE_URL at the
// docker-compose postgres. Tests are isolated by truncating all tables
// in `resetDb()` between runs — faster than rolling migrations per test.

export const testPrisma = new PrismaClient();

// Tables listed in dependency order so the TRUNCATE … CASCADE is harmless
// either way but stays explicit. AlgorithmAuditRecord is rarely touched
// from these tests but included for completeness.
const TABLES = [
  "Message",
  "Conversation",
  "Match",
  "Like",
  "SwipeAction",
  "Report",
  "Block",
  "ProfilePhoto",
  "Preferences",
  "Profile",
  "DeviceToken",
  "AuthChallenge",
  "Session",
  "User",
  "AlgorithmAuditRecord",
];

export async function resetDb(): Promise<void> {
  await testPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

interface CreateUserOptions {
  age?: number;
  displayName?: string;
  gender?: "Woman" | "Man" | "NonBinary" | "PreferNotToSay";
  city?: string;
  // Lat/lng default to downtown San Jose so every fixture is geo-eligible
  // for every other fixture out of the box.
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
  interestedGenders?: Array<"Woman" | "Man" | "NonBinary" | "PreferNotToSay">;
}

let userCounter = 0;

// Create a full user (User + Profile + Preferences + location) wired up so
// the swipe / match / discovery code paths can run against it.
export async function createUser(opts: CreateUserOptions = {}) {
  userCounter += 1;
  const age = opts.age ?? 28;
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - age);

  const user = await testPrisma.user.create({
    data: {
      authProvider: "email",
      dateOfBirth: dob,
      isAgeVerified: true,
      emailHash: `test-${userCounter}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });

  await testPrisma.profile.create({
    data: {
      userId: user.id,
      displayName: opts.displayName ?? `Test User ${userCounter}`,
      gender: opts.gender ?? "Woman",
      city: opts.city ?? "San Jose",
    },
  });

  const lat = opts.lat ?? 37.3382;
  const lng = opts.lng ?? -121.8863;
  await testPrisma.$executeRawUnsafe(
    `UPDATE "Profile" SET "location" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE "userId" = $3`,
    lng,
    lat,
    user.id,
  );

  await testPrisma.preferences.create({
    data: {
      userId: user.id,
      minAge: 18,
      maxAge: 99,
      maxDistanceKm: opts.maxDistanceKm ?? 100,
      interestedGenders: opts.interestedGenders ?? ["Woman", "Man", "NonBinary"],
    },
  });

  return user;
}
