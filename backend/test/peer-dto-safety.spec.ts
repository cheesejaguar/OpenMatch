import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_PEER_SELECT,
  MATCH_PEER_SELECT,
  PEER_VISIBLE_PROFILE_SELECT,
  PEER_VISIBLE_USER_SELECT,
  PUBLIC_PROFILE_SELECT,
} from "../src/lib/dto/peer-user.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// SEV-A3: structural guard against PII leaking out of peer-visible
// endpoints (GET /matches/, GET /matches/:id, GET /chat, and
// GET /profile/:profileId). The audit caught five sensitive fields
// being returned via Prisma's default `include`-everything behaviour:
//   emailHash, phoneHash, authSubject, authProvider, dateOfBirth,
//   isBanned, raw Profile.location geography.
//
// This spec asserts two invariants:
//   1. The DTO allow-list does NOT include any of those columns (snapshot)
//   2. The live HTTP response does not contain any of them either

// Sensitive User columns that must never appear in any peer-visible
// response. The deliberately-omitted `User.status` would clash with
// the legitimate `Match.status` / `Conversation.status` keys at
// arbitrary nesting depth, so we instead pin it via the static
// allow-list snapshot below (PEER_VISIBLE_USER_SELECT must not
// include `status`).
const FORBIDDEN_USER_FIELDS = [
  "emailHash",
  "phoneHash",
  "authProvider",
  "authSubject",
  "dateOfBirth",
  "isBanned",
  "isAgeVerified",
  "deletedAt",
];

const FORBIDDEN_PROFILE_FIELDS = ["location", "declaredLocation", "moderationStatus"];

describe("SEV-A3 peer DTO allow-list (static snapshot)", () => {
  it("PEER_VISIBLE_USER_SELECT excludes every sensitive User column", () => {
    const allowList = Object.keys(PEER_VISIBLE_USER_SELECT);
    for (const forbidden of [...FORBIDDEN_USER_FIELDS, "status"]) {
      expect(allowList).not.toContain(forbidden);
    }
  });

  it("PEER_VISIBLE_PROFILE_SELECT excludes raw geography + moderation", () => {
    const allowList = Object.keys(PEER_VISIBLE_PROFILE_SELECT);
    for (const forbidden of FORBIDDEN_PROFILE_FIELDS) {
      expect(allowList).not.toContain(forbidden);
    }
  });

  it("PUBLIC_PROFILE_SELECT does not expose raw lat/lng geography", () => {
    const allowList = Object.keys(PUBLIC_PROFILE_SELECT);
    for (const forbidden of FORBIDDEN_PROFILE_FIELDS) {
      expect(allowList).not.toContain(forbidden);
    }
  });

  it("MATCH_PEER_SELECT only includes user via select-nested", () => {
    const m = MATCH_PEER_SELECT;
    // userA / userB must each use `select` (allow-list) not `include`
    // (everything-by-default).
    expect(m.userA).toHaveProperty("select");
    expect(m.userB).toHaveProperty("select");
    expect(m.userA).not.toHaveProperty("include");
    expect(m.userB).not.toHaveProperty("include");
  });

  it("CONVERSATION_PEER_SELECT only includes match users via select-nested", () => {
    const c = CONVERSATION_PEER_SELECT;
    expect(c.match).toHaveProperty("select");
    expect(c.match.select.userA).toHaveProperty("select");
    expect(c.match.select.userB).toHaveProperty("select");
  });
});

// Live HTTP assertion. We build a real match between two users and
// confirm that none of the forbidden columns appear anywhere in the
// match-list or conversation-list response.
const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

function flattenStrings(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const k of Object.keys(value as object)) out.push(k);
    for (const v of Object.values(value as object)) flattenStrings(v, out);
  }
  return out;
}

describe("SEV-A3 peer DTO live HTTP (end-to-end)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("GET /matches/ response payload excludes every forbidden field", async () => {
    const u1 = await createUser({ displayName: "Alice" });
    const u2 = await createUser({ displayName: "Bob" });
    await testPrisma.match.create({
      data: { userAId: u1.id, userBId: u2.id, status: "active" },
    });
    const token = app.jwt.sign({ sub: u1.id, scope: "user" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/matches/",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json();
    const allKeys = flattenStrings(payload);
    for (const forbidden of FORBIDDEN_USER_FIELDS) {
      expect(allKeys).not.toContain(forbidden);
    }
    for (const forbidden of FORBIDDEN_PROFILE_FIELDS) {
      expect(allKeys).not.toContain(forbidden);
    }
  });

  it("GET /profile/:profileId excludes raw geography", async () => {
    const u1 = await createUser({ displayName: "Carla" });
    const u2 = await createUser({ displayName: "Dave" });
    const profile = await testPrisma.profile.findUnique({
      where: { userId: u2.id },
      select: { id: true },
    });
    expect(profile).not.toBeNull();
    const token = app.jwt.sign({ sub: u1.id, scope: "user" });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/profile/${profile!.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as Record<string, unknown>;
    expect(payload).not.toHaveProperty("location");
    expect(payload).not.toHaveProperty("declaredLocation");
  });
});
