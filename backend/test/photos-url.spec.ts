import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import authPlugin from "../src/plugins/auth.js";
import ratelimitPlugin from "../src/plugins/ratelimit.js";
import { photosRoutes } from "../src/routes/photos.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// SEV-N16 / SEV-M7 — photo URL minting + serve proxy authorization.
//
// Coverage:
//   - Owner can mint a URL for their own photo and the serve endpoint
//     streams bytes back.
//   - A random user (no match, no block) is forbidden.
//   - Matched users can mint URLs for each other's photos.
//   - When the requester is blocked by the owner, /url returns 404
//     (blocks must never leak existence).
//   - Tampered tokens are rejected with 401.
//   - Expired tokens are rejected.

const LOCAL_DIR = path.resolve(process.cwd(), ".local-media");

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", testPrisma);
  await app.register(authPlugin);
  await app.register(ratelimitPlugin);
  await app.register(photosRoutes, { prefix: "/api/v1/photos" });
  return app;
}

function bearer(userId: string, app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: userId, scope: "user" });
  return `Bearer ${token}`;
}

async function seedPhoto(
  userId: string,
  opts: { bytes?: Buffer } = {},
): Promise<{ photoId: string; storageKey: string }> {
  const profile = await testPrisma.profile.findUnique({ where: { userId } });
  if (!profile) throw new Error("createUser did not create profile");
  const storageKey = `profiles/${profile.id}/test-${Math.random().toString(36).slice(2)}.jpg`;
  const cdnUrl = `/media/${encodeURIComponent(storageKey)}`;
  const full = path.join(LOCAL_DIR, storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, opts.bytes ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // tiny JPEG header
  const photo = await testPrisma.profilePhoto.create({
    data: {
      profileId: profile.id,
      storageKey,
      cdnUrl,
      sortOrder: 0,
    },
  });
  return { photoId: photo.id, storageKey };
}

describe("GET /api/v1/photos/:id/url + /serve", () => {
  beforeEach(async () => {
    await resetDb();
    // Clean local media so seeding doesn't accumulate between runs.
    await rm(LOCAL_DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
    await rm(LOCAL_DIR, { recursive: true, force: true });
  });

  it("owner can mint a URL and the serve endpoint returns the bytes", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const { photoId } = await seedPhoto(owner.id, { bytes: payload });

      const urlRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/url`,
        headers: { authorization: bearer(owner.id, app) },
      });
      expect(urlRes.statusCode).toBe(200);
      const body = urlRes.json() as { url: string; expiresAt: string };
      expect(body.url).toContain(`/api/v1/photos/${photoId}/serve?token=`);
      expect(body.url).toContain(`aud=${owner.id}`);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const serveRes = await app.inject({ method: "GET", url: body.url });
      expect(serveRes.statusCode).toBe(200);
      expect(serveRes.headers["content-type"]).toBe("image/jpeg");
      expect(serveRes.rawPayload.equals(payload)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("non-matched random user gets 403 from /url", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const stranger = await createUser({ displayName: "Stranger" });
      const { photoId } = await seedPhoto(owner.id);

      const urlRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/url`,
        headers: { authorization: bearer(stranger.id, app) },
      });
      expect(urlRes.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("matched user (active match, no blocks) can mint a URL", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const peer = await createUser({ displayName: "Peer" });
      const { photoId } = await seedPhoto(owner.id);
      await testPrisma.match.create({
        data: { userAId: owner.id, userBId: peer.id, status: "active" },
      });

      const urlRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/url`,
        headers: { authorization: bearer(peer.id, app) },
      });
      expect(urlRes.statusCode).toBe(200);
      const body = urlRes.json() as { url: string };

      const serveRes = await app.inject({ method: "GET", url: body.url });
      expect(serveRes.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("requester blocked by owner gets 404 — block status must not leak", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const blocked = await createUser({ displayName: "Blocked" });
      // Owner and blocked WERE matched, but owner blocked the user.
      await testPrisma.match.create({
        data: { userAId: owner.id, userBId: blocked.id, status: "active" },
      });
      await testPrisma.block.create({
        data: { blockerUserId: owner.id, blockedUserId: blocked.id },
      });
      const { photoId } = await seedPhoto(owner.id);

      const urlRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/url`,
        headers: { authorization: bearer(blocked.id, app) },
      });
      expect(urlRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("requester who blocked the owner gets 404 (symmetric)", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const blocker = await createUser({ displayName: "Blocker" });
      await testPrisma.match.create({
        data: { userAId: owner.id, userBId: blocker.id, status: "active" },
      });
      await testPrisma.block.create({
        data: { blockerUserId: blocker.id, blockedUserId: owner.id },
      });
      const { photoId } = await seedPhoto(owner.id);

      const urlRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/url`,
        headers: { authorization: bearer(blocker.id, app) },
      });
      expect(urlRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("serve endpoint rejects a tampered signature", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const { photoId } = await seedPhoto(owner.id);
      const urlRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/url`,
        headers: { authorization: bearer(owner.id, app) },
      });
      const { url } = urlRes.json() as { url: string };
      // Flip a hex char in the signature.
      const tampered = url.replace(/[0-9a-f]&/, (m) => (m[0] === "0" ? `1${m[1]}` : `0${m[1]}`));
      const serveRes = await app.inject({ method: "GET", url: tampered });
      expect(serveRes.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("serve endpoint rejects an expired token", async () => {
    // Use the photo-tokens helper directly to mint a token with a TTL in
    // the past, then ensure /serve returns 401 photo_url_token_expired.
    const { signPhotoToken } = await import("../src/lib/photo-tokens.js");
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const { photoId } = await seedPhoto(owner.id);
      const expired = signPhotoToken({ photoId, audienceUserId: owner.id }, { ttlSeconds: -10 });
      const serveRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/serve?token=${encodeURIComponent(expired)}&aud=${owner.id}`,
      });
      expect(serveRes.statusCode).toBe(401);
      const body = serveRes.json() as { error?: string; code?: string };
      // Code surfaces in body.error or body.code depending on httpError shape.
      const code = body.error ?? body.code ?? "";
      expect(code).toMatch(/photo_url_token_expired|expired/);
    } finally {
      await app.close();
    }
  });

  it("requesting a non-existent photo id returns 404", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const urlRes = await app.inject({
        method: "GET",
        url: "/api/v1/photos/does-not-exist/url",
        headers: { authorization: bearer(owner.id, app) },
      });
      expect(urlRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("/url requires authentication", async () => {
    const app = await build();
    try {
      const owner = await createUser({ displayName: "Owner" });
      const { photoId } = await seedPhoto(owner.id);
      const urlRes = await app.inject({
        method: "GET",
        url: `/api/v1/photos/${photoId}/url`,
      });
      expect(urlRes.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
