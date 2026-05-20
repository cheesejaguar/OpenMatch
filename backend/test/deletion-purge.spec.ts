import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.js";
import ratelimitPlugin from "../src/plugins/ratelimit.js";
import { internalRoutes } from "../src/routes/internal.js";
import { scheduleAccountDeletion } from "../src/services/privacy.service.js";
import { runDeletionPurgeOnce } from "../src/workers/deletion.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

const LOCAL_MEDIA_DIR = path.resolve(process.cwd(), ".local-media");

// COMP-3 — account deletion purge worker.
//
// Coverage:
//   - scheduling a deletion, fast-forwarding its grace window, and
//     verifying the worker anonymises the User + Profile and hard-deletes
//     swipes, likes, sessions, push tokens, analytics events.
//   - matches + authored messages are RETAINED as tombstones.
//   - the internal endpoint requires the bearer token.

async function buildInternalApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", testPrisma);
  await app.register(ratelimitPlugin);
  await app.register(internalRoutes, { prefix: "/api/v1/internal" });
  return app;
}

describe("deletion purge worker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("anonymises the user, deletes auxiliary rows, keeps matches + messages", async () => {
    const victim = await createUser({ displayName: "ToDelete" });
    const peer = await createUser({ displayName: "Peer" });

    // Seed: session, push token, swipes, likes, analytics, feedback,
    // match + conversation + message.
    await testPrisma.session.create({
      data: {
        userId: victim.id,
        refreshToken: `rt-${victim.id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await testPrisma.notificationDevice.create({
      data: { userId: victim.id, platform: "ios", token: "device-token-1" },
    });
    await testPrisma.swipeAction.create({
      data: {
        viewerUserId: victim.id,
        targetUserId: peer.id,
        decision: "like",
        algorithmVersion: "test",
        rankingConfigVersion: "test",
        deckSessionId: "ds1",
      },
    });
    await testPrisma.like.create({
      data: { fromUserId: victim.id, toUserId: peer.id, status: "active" },
    });
    await testPrisma.analyticsEvent.create({
      data: { userId: victim.id, eventName: "app_opened" },
    });
    await testPrisma.betaFeedback.create({
      data: { userId: victim.id, category: "bug", body: "x" },
    });
    const match = await testPrisma.match.create({
      data: { userAId: victim.id, userBId: peer.id, status: "active" },
    });
    const convo = await testPrisma.conversation.create({
      data: { matchId: match.id, status: "active" },
    });
    await testPrisma.message.create({
      data: { conversationId: convo.id, senderUserId: victim.id, body: "hi" },
    });

    // Schedule and fast-forward grace window.
    const req = await scheduleAccountDeletion(testPrisma, { userId: victim.id });
    await testPrisma.accountDeletionRequest.update({
      where: { id: req.id },
      data: { gracePeriodEndsAt: new Date(Date.now() - 1_000) },
    });

    const report = await runDeletionPurgeOnce(testPrisma);
    expect(report.purged).toBe(1);
    expect(report.errors).toBe(0);

    // User anonymised — row retained, identifiers cleared.
    const updatedUser = await testPrisma.user.findUnique({ where: { id: victim.id } });
    expect(updatedUser?.status).toBe("deleted");
    expect(updatedUser?.emailHash).toBeNull();
    expect(updatedUser?.deletedAt).toBeInstanceOf(Date);

    const profile = await testPrisma.profile.findUnique({ where: { userId: victim.id } });
    expect(profile?.displayName).toBe("[deleted]");
    expect(profile?.city).toBeNull();
    expect(profile?.visibilityStatus).toBe("hidden");

    // Hard-deleted tables.
    expect(await testPrisma.session.count({ where: { userId: victim.id } })).toBe(0);
    expect(await testPrisma.notificationDevice.count({ where: { userId: victim.id } })).toBe(0);
    expect(
      await testPrisma.swipeAction.count({
        where: { OR: [{ viewerUserId: victim.id }, { targetUserId: victim.id }] },
      }),
    ).toBe(0);
    expect(
      await testPrisma.like.count({
        where: { OR: [{ fromUserId: victim.id }, { toUserId: victim.id }] },
      }),
    ).toBe(0);
    expect(await testPrisma.analyticsEvent.count({ where: { userId: victim.id } })).toBe(0);
    expect(await testPrisma.betaFeedback.count({ where: { userId: victim.id } })).toBe(0);

    // Match + conversation + message retained as tombstones.
    expect(await testPrisma.match.count({ where: { id: match.id } })).toBe(1);
    expect(await testPrisma.message.count({ where: { conversationId: convo.id } })).toBe(1);

    // AccountDeletionRequest moved to purged status.
    const after = await testPrisma.accountDeletionRequest.findUnique({
      where: { id: req.id },
    });
    expect(after?.status).toBe("purged");
    expect(after?.purgedAt).toBeInstanceOf(Date);
  });

  it("hard-deletes the user's photo blobs from storage as well as DB rows", async () => {
    // SEV-N16 / SEV-M7: the worker previously deleted ProfilePhoto rows
    // but left the underlying blobs orphaned ("CDN cleanup is out-of-band"
    // comment). Verify the local-fs dev branch — which mirrors the
    // production `del()` call — actually removes files.
    const user = await createUser({ displayName: "WithPhotos" });
    const profile = await testPrisma.profile.findUnique({ where: { userId: user.id } });
    const profileId = profile!.id;

    const storageKey = `profiles/${profileId}/purge-test-${Math.random().toString(36).slice(2)}.jpg`;
    const cdnUrl = `/media/${encodeURIComponent(storageKey)}`;
    const filePath = path.join(LOCAL_MEDIA_DIR, storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await testPrisma.profilePhoto.create({
      data: { profileId, storageKey, cdnUrl, sortOrder: 0 },
    });

    // Sanity: file was actually created.
    await expect(access(filePath)).resolves.toBeUndefined();

    const req = await scheduleAccountDeletion(testPrisma, { userId: user.id });
    await testPrisma.accountDeletionRequest.update({
      where: { id: req.id },
      data: { gracePeriodEndsAt: new Date(Date.now() - 1_000) },
    });

    const report = await runDeletionPurgeOnce(testPrisma);
    expect(report.purged).toBe(1);
    expect(report.errors).toBe(0);

    // DB row gone.
    expect(await testPrisma.profilePhoto.count({ where: { profileId } })).toBe(0);
    // Blob file gone — access() should now reject.
    await expect(access(filePath)).rejects.toBeTruthy();
  });

  it("ignores deletions whose grace window has not yet elapsed", async () => {
    const u = await createUser();
    const req = await scheduleAccountDeletion(testPrisma, { userId: u.id });
    expect(req.status).toBe("scheduled");
    const report = await runDeletionPurgeOnce(testPrisma);
    expect(report.purged).toBe(0);
    const after = await testPrisma.accountDeletionRequest.findUnique({
      where: { id: req.id },
    });
    expect(after?.status).toBe("scheduled");
  });

  it("internal endpoint rejects unauthenticated calls", async () => {
    const app = await buildInternalApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/internal/run-deletion-purge",
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("internal endpoint accepts the bearer token and returns a report", async () => {
    const app = await buildInternalApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/internal/run-deletion-purge",
        headers: { authorization: `Bearer ${env.INTERNAL_WORKER_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { purged: number; errors: number; durationMs: number };
      expect(body.purged).toBe(0);
      expect(body.errors).toBe(0);
      expect(typeof body.durationMs).toBe("number");
    } finally {
      await app.close();
    }
  });
});
