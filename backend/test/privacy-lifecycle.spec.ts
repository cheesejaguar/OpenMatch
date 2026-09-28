import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPhotoToken } from "../src/lib/photo-tokens.js";
import {
  buildExportBundle,
  getNotificationPreferences,
  openDsar,
  publishPolicyDocument,
  recordConsent,
  withdrawConsent,
} from "../src/services/privacy.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

describe("privacy lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
    await testPrisma.policyDocument.deleteMany();
  });
  afterAll(() => testPrisma.$disconnect());

  it("never rewrites a published policy version", async () => {
    const policy = {
      scope: "analytics" as const,
      version: "v1",
      text: "original",
      effectiveAt: new Date("2025-01-01"),
    };
    const published = await Promise.all(
      Array.from({ length: 4 }, () => publishPolicyDocument(testPrisma, policy)),
    );
    expect(new Set(published.map((row) => row.id)).size).toBe(1);
    const first = published[0]!;
    expect((await publishPolicyDocument(testPrisma, policy)).id).toBe(first.id);
    await expect(
      publishPolicyDocument(testPrisma, { ...policy, text: "changed" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (await testPrisma.policyDocument.findUniqueOrThrow({ where: { id: first.id } })).textHash,
    ).toBe(first.textHash);
  });

  it("allows withdrawal of a legacy grant without a currently published policy", async () => {
    const user = await createUser();
    const grant = await recordConsent(testPrisma, {
      userId: user.id,
      scope: "analytics",
      granted: true,
      surface: "test",
      policyVersion: "legacy",
      textHash: "legacy-hash",
    });
    const withdrawn = await withdrawConsent(testPrisma, {
      userId: user.id,
      scope: "analytics",
      surface: "test",
    });
    expect(withdrawn.granted).toBe(false);
    expect(withdrawn.policyVersion).toBe("legacy");
    expect(withdrawn.textHash).toBe("legacy-hash");
    expect(
      (await testPrisma.consentRecord.findUniqueOrThrow({ where: { id: grant.id } })).withdrawnAt,
    ).not.toBeNull();
  });

  it("initializes notification defaults atomically under concurrent calls", async () => {
    const user = await createUser();
    const rows = await Promise.all(
      Array.from({ length: 4 }, () => getNotificationPreferences(testPrisma, user.id)),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(rows.every((r) => !r.productNewsEmail && !r.productNewsPush && !r.productNewsSms)).toBe(
      true,
    );
  });

  it("does not reset saved notification preferences or their timestamps", async () => {
    const user = await createUser();
    const saved = await testPrisma.notificationPreference.create({
      data: { userId: user.id, productNewsEmail: true, newMatchPush: false },
    });
    const rows = await Promise.all(
      Array.from({ length: 4 }, () => getNotificationPreferences(testPrisma, user.id)),
    );
    for (const row of rows) expect(row).toEqual(saved);
  });

  it("exports aggregate swipe history and revocable photo links without storage bearer URLs", async () => {
    const user = await createUser();
    const peer = await createUser();
    const profile = await testPrisma.profile.update({
      where: { userId: user.id },
      data: { company: "Private employer", companyDisplayEnabled: false, values: ["family"] },
    });
    const photo = await testPrisma.profilePhoto.create({
      data: {
        profileId: profile.id,
        storageKey: "private-key",
        cdnUrl: "https://storage.invalid/permanent-bearer",
        sortOrder: 0,
      },
    });
    const first = new Date("2025-01-01");
    const last = new Date("2025-02-01");
    await testPrisma.swipeAction.createMany({
      data: [
        {
          viewerUserId: user.id,
          targetUserId: peer.id,
          decision: "like",
          algorithmVersion: "test",
          rankingConfigVersion: "test",
          deckSessionId: "one",
          createdAt: first,
        },
        {
          viewerUserId: user.id,
          targetUserId: peer.id,
          decision: "reject",
          algorithmVersion: "test",
          rankingConfigVersion: "test",
          deckSessionId: "two",
          createdAt: last,
          undoneAt: last,
        },
      ],
    });
    await testPrisma.like.create({
      data: { fromUserId: user.id, toUserId: peer.id, status: "active" },
    });
    const bundle = await buildExportBundle(testPrisma, user.id);
    expect(bundle.swipesSummary).toMatchObject({
      totalSwipes: 2,
      likes: 1,
      rejects: 1,
      undone: 1,
      firstSwipeAt: first,
      lastSwipeAt: last,
    });
    expect(bundle.profile).toMatchObject({ company: "Private employer", values: ["family"] });
    expect(JSON.stringify(bundle)).not.toContain("permanent-bearer");
    expect(JSON.stringify(bundle)).not.toContain("private-key");
    expect(JSON.stringify(bundle)).not.toContain(peer.id);
    expect(bundle.likesSent[0]?.peer).toMatch(/^peer:[a-f0-9]{32}$/);
    const url = new URL(String(bundle.photos[0]?.cdnUrl), "https://api.example.test");
    expect(
      verifyPhotoToken(url.searchParams.get("token")!, {
        photoId: photo.id,
        audienceUserId: user.id,
      }).ok,
    ).toBe(true);
  });

  it("uses a 28-day operational DSAR target", async () => {
    const now = Date.now();
    const request = await openDsar(testPrisma, { requestType: "access", channel: "in_app" });
    expect(request.dueAt!.getTime() - now).toBeGreaterThanOrEqual(28 * 86400_000);
    expect(request.dueAt!.getTime() - now).toBeLessThan(28 * 86400_000 + 1000);
  });
});
