import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as media from "../src/lib/media.js";
import {
  cancelAccountDeletion,
  performAccountErasure,
  scheduleAccountDeletion,
} from "../src/services/privacy.service.js";
import { runDeletionPurgeOnce } from "../src/workers/deletion.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

async function due(userId: string) {
  const request = await scheduleAccountDeletion(testPrisma, { userId });
  return testPrisma.accountDeletionRequest.update({
    where: { id: request.id },
    data: { gracePeriodEndsAt: new Date(Date.now() - 1000) },
  });
}

describe("account deletion lifecycle", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => testPrisma.$disconnect());

  it("deduplicates concurrent schedules and permits repeated cancellation cycles", async () => {
    const user = await createUser();
    const requests = await Promise.all(
      Array.from({ length: 4 }, () => scheduleAccountDeletion(testPrisma, { userId: user.id })),
    );
    expect(new Set(requests.map((r) => r.id)).size).toBe(1);
    await cancelAccountDeletion(testPrisma, user.id);
    await scheduleAccountDeletion(testPrisma, { userId: user.id });
    await cancelAccountDeletion(testPrisma, user.id);
    expect(
      await testPrisma.accountDeletionRequest.count({
        where: { userId: user.id, status: "cancelled" },
      }),
    ).toBe(2);
    expect(
      (await testPrisma.profile.findUniqueOrThrow({ where: { userId: user.id } })).visibilityStatus,
    ).toBe("hidden");
    expect(
      (await testPrisma.preferences.findUniqueOrThrow({ where: { userId: user.id } }))
        .discoveryPaused,
    ).toBe(true);
  });

  it("does not lift bans when a deletion is cancelled", async () => {
    const user = await createUser();
    await testPrisma.user.update({
      where: { id: user.id },
      data: { status: "banned", isBanned: true },
    });
    await scheduleAccountDeletion(testPrisma, { userId: user.id });
    await cancelAccountDeletion(testPrisma, user.id);
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe(
      "banned",
    );
  });

  it("lets only one overlapping worker finalize a request", async () => {
    const user = await createUser();
    await due(user.id);
    const reports = await Promise.all([
      runDeletionPurgeOnce(testPrisma),
      runDeletionPurgeOnce(testPrisma),
    ]);
    expect(reports.reduce((sum, r) => sum + r.purged, 0)).toBe(1);
    expect(reports.reduce((sum, r) => sum + r.errors, 0)).toBe(0);
  });

  it("retains storage references on failure and completes on retry", async () => {
    const user = await createUser();
    const profile = await testPrisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
    await testPrisma.profilePhoto.create({
      data: {
        profileId: profile.id,
        storageKey: "profiles/retry.jpg",
        cdnUrl: "https://storage.invalid/retry.jpg",
        sortOrder: 0,
      },
    });
    const request = await due(user.id);
    const deletion = vi
      .spyOn(media, "deleteProfilePhoto")
      .mockResolvedValueOnce({ ok: false, error: "private-storage-detail" })
      .mockResolvedValue({ ok: true });
    const failed = await runDeletionPurgeOnce(testPrisma);
    expect(failed.errors).toBe(1);
    expect(JSON.stringify(failed)).not.toContain("private-storage-detail");
    expect(await testPrisma.profilePhoto.count({ where: { profileId: profile.id } })).toBe(1);
    expect(
      (await testPrisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .status,
    ).toBe("scheduled");
    expect((await runDeletionPurgeOnce(testPrisma)).purged).toBe(1);
    expect(deletion).toHaveBeenCalledTimes(2);
  });

  it("recovers an abandoned lease and clears sensitive profile and verification data", async () => {
    const user = await createUser();
    await testPrisma.profile.update({
      where: { userId: user.id },
      data: {
        prompts: [{ question: "q", answer: "private" }],
        values: ["family"],
        isPhotoVerified: true,
      },
    });
    await testPrisma.verificationRequest.create({
      data: {
        userId: user.id,
        challengePrompt: "pose",
        challengeNonce: "nonce",
        imageStorageKey: "profiles/verification/selfie.jpg",
      },
    });
    const deletion = vi.spyOn(media, "deleteProfilePhoto").mockResolvedValue({ ok: true });
    const request = await due(user.id);
    await testPrisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: "in_progress",
        startedAt: new Date(Date.now() - 6 * 60_000),
        leaseToken: "abandoned",
      },
    });
    expect((await runDeletionPurgeOnce(testPrisma)).purged).toBe(1);
    const profile = await testPrisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.prompts).toBeNull();
    expect(profile.values).toEqual([]);
    expect(profile.isPhotoVerified).toBe(false);
    expect(await testPrisma.verificationRequest.count({ where: { userId: user.id } })).toBe(0);
    expect(await testPrisma.preferences.count({ where: { userId: user.id } })).toBe(0);
    expect(deletion).toHaveBeenCalledWith(
      "profiles/verification/selfie.jpg",
      "profiles/verification/selfie.jpg",
    );
  });

  it("keeps a live lease exclusive and refuses late cancellation", async () => {
    const user = await createUser();
    const request = await due(user.id);
    await expect(cancelAccountDeletion(testPrisma, user.id)).rejects.toMatchObject({
      statusCode: 409,
    });
    await testPrisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: "in_progress", startedAt: new Date(), leaseToken: "running" },
    });
    expect((await runDeletionPurgeOnce(testPrisma)).purged).toBe(0);
    await expect(performAccountErasure(testPrisma, user.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("routes direct erasure through the same purge including signup-only accounts", async () => {
    const user = await createUser();
    await testPrisma.profile.delete({ where: { userId: user.id } });
    const request = await due(user.id);
    await expect(performAccountErasure(testPrisma, user.id)).resolves.toEqual({
      ok: true,
      requestId: request.id,
    });
    expect(
      (await testPrisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .status,
    ).toBe("purged");
  });
});
