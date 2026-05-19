import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  _setApnProviderForTests,
  type ApnNotificationLike,
  type ApnProviderLike,
  runPushRetryOnce,
  sendPush,
} from "../src/services/push.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// OPS-1 — APNs delivery worker.
//
// Coverage:
//   - notification preferences gate (e.g. newMatchPush=false skips)
//   - device freshness window (90 days)
//   - successful send writes a PushDeliveryLog row with success=true
//   - retry on a transient failure
//   - device cleanup on `Unregistered` / `BadDeviceToken`
//   - retry worker re-attempts recent failures

interface MockProviderState {
  scripted: Array<"ok" | "transient" | "unregistered" | "bad_token">;
  calls: Array<{ token: string; note: ApnNotificationLike }>;
}

function makeMockProvider(state: MockProviderState): ApnProviderLike {
  return {
    async send(note, recipients) {
      const tokens = Array.isArray(recipients) ? recipients : [recipients];
      const next = state.scripted.shift() ?? "ok";
      state.calls.push({ token: tokens[0]!, note });
      if (next === "ok") {
        return { sent: tokens.map((t) => ({ device: t })), failed: [] };
      }
      if (next === "transient") {
        return {
          sent: [],
          failed: tokens.map((t) => ({
            device: t,
            status: 500,
            response: { reason: "InternalServerError" },
          })),
        };
      }
      if (next === "unregistered") {
        return {
          sent: [],
          failed: tokens.map((t) => ({
            device: t,
            status: 410,
            response: { reason: "Unregistered" },
          })),
        };
      }
      // bad_token
      return {
        sent: [],
        failed: tokens.map((t) => ({
          device: t,
          status: 400,
          response: { reason: "BadDeviceToken" },
        })),
      };
    },
  };
}

describe("push service", () => {
  beforeEach(async () => {
    await resetDb();
    _setApnProviderForTests(null);
  });

  afterAll(async () => {
    _setApnProviderForTests(null);
    await testPrisma.$disconnect();
  });

  it("honours notification preferences (newMatchPush=false skips)", async () => {
    const user = await createUser({ displayName: "PushOptOut" });
    await testPrisma.notificationPreference.create({
      data: { userId: user.id, newMatchPush: false },
    });
    await testPrisma.notificationDevice.create({
      data: { userId: user.id, platform: "ios", token: "dev-1" },
    });
    const state: MockProviderState = { scripted: [], calls: [] };
    const provider = makeMockProvider(state);

    const report = await sendPush(
      testPrisma,
      {
        userId: user.id,
        category: "match",
        alert: { title: "x", body: "y" },
      },
      { provider },
    );

    expect(report.skipped).toBe("preferences");
    expect(state.calls).toHaveLength(0);
    expect(await testPrisma.pushDeliveryLog.count()).toBe(0);
  });

  it("ignores stale devices (lastSeenAt older than 90 days)", async () => {
    const user = await createUser({ displayName: "Stale" });
    await testPrisma.notificationDevice.create({
      data: {
        userId: user.id,
        platform: "ios",
        token: "old-dev",
        lastSeenAt: new Date(Date.now() - 91 * 86_400_000),
      },
    });
    const state: MockProviderState = { scripted: [], calls: [] };
    const provider = makeMockProvider(state);
    const report = await sendPush(
      testPrisma,
      {
        userId: user.id,
        category: "match",
        alert: { title: "x", body: "y" },
      },
      { provider },
    );
    expect(report.skipped).toBe("no_devices");
    expect(state.calls).toHaveLength(0);
  });

  it("sends successfully and logs success row", async () => {
    const user = await createUser({ displayName: "Push" });
    await testPrisma.notificationDevice.create({
      data: { userId: user.id, platform: "ios", token: "dev-good" },
    });
    const state: MockProviderState = { scripted: ["ok"], calls: [] };
    const provider = makeMockProvider(state);
    const report = await sendPush(
      testPrisma,
      {
        userId: user.id,
        category: "match",
        alert: { title: "x", body: "y" },
      },
      { provider },
    );
    expect(report.attempted).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(0);
    const logs = await testPrisma.pushDeliveryLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.success).toBe(true);
    expect(logs[0]!.category).toBe("match");
  });

  it("retries once on a transient failure", async () => {
    const user = await createUser({ displayName: "Retry" });
    await testPrisma.notificationDevice.create({
      data: { userId: user.id, platform: "ios", token: "dev-retry" },
    });
    // First attempt: transient. Second attempt: ok.
    const state: MockProviderState = { scripted: ["transient", "ok"], calls: [] };
    const provider = makeMockProvider(state);
    const report = await sendPush(
      testPrisma,
      {
        userId: user.id,
        category: "message",
        alert: { title: "x", body: "y" },
      },
      { provider },
    );
    expect(report.succeeded).toBe(1);
    expect(state.calls.length).toBe(2);
  });

  it("soft-deletes device on Unregistered", async () => {
    const user = await createUser({ displayName: "Unreg" });
    await testPrisma.notificationDevice.create({
      data: { userId: user.id, platform: "ios", token: "dev-stale" },
    });
    const state: MockProviderState = { scripted: ["unregistered"], calls: [] };
    const provider = makeMockProvider(state);
    const report = await sendPush(
      testPrisma,
      {
        userId: user.id,
        category: "like",
        alert: { title: "x", body: "y" },
      },
      { provider },
    );
    expect(report.failed).toBe(1);
    expect(report.failures[0]!.reason).toBe("Unregistered");
    const devices = await testPrisma.notificationDevice.findMany({
      where: { userId: user.id },
    });
    expect(devices).toHaveLength(0);
  });

  it("falls back gracefully when no provider is configured", async () => {
    const user = await createUser({ displayName: "NoProvider" });
    await testPrisma.notificationDevice.create({
      data: { userId: user.id, platform: "ios", token: "dev-nop" },
    });
    // No provider injected, no APNs env set → "no_provider" branch.
    const report = await sendPush(testPrisma, {
      userId: user.id,
      category: "safety",
      alert: { title: "x", body: "y" },
    });
    expect(report.skipped).toBe("no_provider");
    expect(report.failed).toBe(1);
    const logs = await testPrisma.pushDeliveryLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.failureReason).toBe("apns_not_configured");
  });

  it("retry worker re-runs recent transient failures", async () => {
    const user = await createUser({ displayName: "RetryWorker" });
    const device = await testPrisma.notificationDevice.create({
      data: { userId: user.id, platform: "ios", token: "dev-retry-w" },
    });
    // Seed a recent failure row that ISN'T an APNs-unconfigured / bad-token
    // case — so the retry path picks it up.
    await testPrisma.pushDeliveryLog.create({
      data: {
        userId: user.id,
        deviceId: device.id,
        category: "match",
        success: false,
        failureReason: "InternalServerError",
      },
    });
    const state: MockProviderState = { scripted: ["ok"], calls: [] };
    const provider = makeMockProvider(state);
    const report = await runPushRetryOnce(testPrisma, { provider });
    expect(report.retried).toBe(1);
    expect(report.succeeded).toBe(1);
  });
});
