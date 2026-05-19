import type { PrismaClient } from "@prisma/client";
import { env } from "../env.js";

// OPS-1 — APNs delivery service.
//
// Honours the recipient's NotificationPreference row (push-category opt
// outs) and the recipient's notification-device freshness window
// (90 days since lastSeenAt). When the APNs credentials are absent, this
// is a no-op and logs a warning at startup — letting dev/CI and
// integration tests run end-to-end without real credentials.
//
// Retry policy: on a transient failure (timeout, 429, or 5xx), retry
// once with up to 250ms of exponential backoff. On `BadDeviceToken` or
// `Unregistered`, soft-delete the device row so future fan-outs skip it.
//
// Every send attempt — success or failure — writes a PushDeliveryLog
// row so the retry worker can find recent failures and the admin
// dashboard can answer "is push working right now?".

export type PushCategory = "match" | "message" | "like" | "safety";

export interface PushNotification {
  userId: string;
  alert: { title: string; body: string };
  payload?: Record<string, unknown>;
  category: PushCategory;
  badge?: number;
  threadId?: string;
  priority?: 5 | 10;
}

export interface PushSendReport {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: "preferences" | "no_devices" | "no_provider" | null;
  failures: Array<{ deviceId: string; reason: string }>;
}

// Minimal provider surface so we can swap a real @parse/node-apn Provider
// for a fake in tests without dragging the whole apn module surface.
export interface ApnProviderLike {
  send(
    notification: ApnNotificationLike,
    recipients: string | string[],
  ): Promise<{
    sent: Array<{ device: string }>;
    failed: Array<{
      device: string;
      status?: number;
      response?: { reason?: string };
      error?: { message?: string } | Error;
    }>;
  }>;
}

export interface ApnNotificationLike {
  topic?: string;
  alert?: unknown;
  badge?: number;
  threadId?: string;
  priority?: number;
  pushType?: string;
  payload?: unknown;
}

// The "real" provider type used in production. We dynamically import
// @parse/node-apn so a missing native dependency at build time can't
// break the rest of the backend (and so test runs that mock the
// provider entirely never load it).
let cachedProvider: ApnProviderLike | null = null;
let providerLoadFailed = false;

function decodeApnsPrivateKey(raw: string): Buffer {
  // Allow either raw PEM (with newlines) or a base64-encoded PEM. We
  // detect base64 by the absence of "BEGIN " (PEM headers always include
  // it, and base64 of a PEM never does).
  if (raw.includes("BEGIN ")) {
    return Buffer.from(raw, "utf8");
  }
  return Buffer.from(raw, "base64");
}

async function getDefaultProvider(): Promise<ApnProviderLike | null> {
  if (cachedProvider) return cachedProvider;
  if (providerLoadFailed) return null;
  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID || !env.APNS_PRIVATE_KEY || !env.APNS_TOPIC) {
    return null;
  }
  try {
    const apn = (await import("@parse/node-apn")) as unknown as {
      Provider: new (opts: unknown) => ApnProviderLike;
    };
    cachedProvider = new apn.Provider({
      token: {
        key: decodeApnsPrivateKey(env.APNS_PRIVATE_KEY),
        keyId: env.APNS_KEY_ID,
        teamId: env.APNS_TEAM_ID,
      },
      production: env.APNS_PRODUCTION ?? false,
    });
    return cachedProvider;
  } catch (err) {
    providerLoadFailed = true;
    // eslint-disable-next-line no-console
    console.warn("[push] failed to load @parse/node-apn:", (err as Error).message);
    return null;
  }
}

// Test seam — lets push.spec.ts inject a fake provider and reset the
// cache between cases.
export function _setApnProviderForTests(p: ApnProviderLike | null): void {
  cachedProvider = p;
  providerLoadFailed = false;
}

// ------- preference filter -------

function isCategoryAllowed(
  prefs: {
    newMatchPush: boolean;
    newMessagePush: boolean;
    newLikePush: boolean;
    safetyPush: boolean;
  } | null,
  category: PushCategory,
): boolean {
  if (!prefs) return true; // default-on if no row exists
  switch (category) {
    case "match":
      return prefs.newMatchPush;
    case "message":
      return prefs.newMessagePush;
    case "like":
      return prefs.newLikePush;
    case "safety":
      return prefs.safetyPush;
  }
}

// ------- main entrypoint -------

const DEVICE_FRESHNESS_DAYS = 90;
const RETRY_BACKOFF_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildApnNotification(n: PushNotification): ApnNotificationLike {
  return {
    topic: env.APNS_TOPIC ?? "app.openmatch.ios",
    alert: n.alert,
    badge: n.badge,
    threadId: n.threadId,
    priority: n.priority ?? 10,
    pushType: "alert",
    payload: { category: n.category, ...(n.payload ?? {}) },
  };
}

function classifyFailure(f: {
  status?: number;
  response?: { reason?: string };
  error?: { message?: string } | Error;
}): { reason: string; retryable: boolean; deviceGone: boolean } {
  const reason =
    f.response?.reason ?? (f.error as Error)?.message ?? `status_${f.status ?? "unknown"}`;
  const deviceGone = reason === "BadDeviceToken" || reason === "Unregistered";
  const retryable =
    !deviceGone &&
    (f.status === 429 ||
      (typeof f.status === "number" && f.status >= 500) ||
      reason === "ECONNRESET" ||
      reason === "ETIMEDOUT" ||
      reason === "TimeoutError");
  return { reason, retryable, deviceGone };
}

async function sendOnce(
  provider: ApnProviderLike,
  token: string,
  apnNote: ApnNotificationLike,
): Promise<{ ok: true } | { ok: false; reason: string; retryable: boolean; deviceGone: boolean }> {
  const resp = await provider.send(apnNote as never, token);
  if (resp.sent.length > 0) return { ok: true };
  const failure = resp.failed[0];
  if (!failure) {
    return { ok: false, reason: "no_response", retryable: false, deviceGone: false };
  }
  return { ok: false, ...classifyFailure(failure) };
}

export interface SendPushOptions {
  // Allows the caller to inject a provider — used by both tests and the
  // (future) cron-based retry worker.
  provider?: ApnProviderLike | null;
}

export async function sendPush(
  prisma: PrismaClient,
  n: PushNotification,
  opts: SendPushOptions = {},
): Promise<PushSendReport> {
  // 1. Preferences gate.
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId: n.userId },
    select: {
      newMatchPush: true,
      newMessagePush: true,
      newLikePush: true,
      safetyPush: true,
    },
  });
  if (!isCategoryAllowed(prefs, n.category)) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: "preferences", failures: [] };
  }

  // 2. Device list.
  const cutoff = new Date(Date.now() - DEVICE_FRESHNESS_DAYS * 86_400_000);
  const devices = await prisma.notificationDevice.findMany({
    where: { userId: n.userId, lastSeenAt: { gt: cutoff } },
    select: { id: true, token: true, platform: true },
  });
  if (devices.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: "no_devices", failures: [] };
  }

  // 3. Provider.
  const provider = opts.provider ?? (await getDefaultProvider());
  if (!provider) {
    // No provider configured — log one delivery-failure row per device so
    // the admin dashboard surface still reflects the attempt, and so the
    // retry worker can find these on a future run when APNs is wired.
    for (const d of devices) {
      await prisma.pushDeliveryLog
        .create({
          data: {
            userId: n.userId,
            deviceId: d.id,
            category: n.category,
            success: false,
            failureReason: "apns_not_configured",
          },
        })
        .catch(() => undefined);
    }
    return {
      attempted: devices.length,
      succeeded: 0,
      failed: devices.length,
      skipped: "no_provider",
      failures: devices.map((d) => ({ deviceId: d.id, reason: "apns_not_configured" })),
    };
  }

  // 4. Send to each device with one retry on transient failures.
  const apnNote = buildApnNotification(n);
  const failures: Array<{ deviceId: string; reason: string }> = [];
  let succeeded = 0;

  for (const d of devices) {
    // iOS-only for v0; quietly skip other platforms.
    if (d.platform !== "ios") continue;

    let result = await sendOnce(provider, d.token, apnNote).catch((err: Error) => ({
      ok: false as const,
      reason: err.message ?? "send_threw",
      retryable: true,
      deviceGone: false,
    }));

    if (!result.ok && result.retryable) {
      await sleep(RETRY_BACKOFF_MS);
      result = await sendOnce(provider, d.token, apnNote).catch((err: Error) => ({
        ok: false as const,
        reason: err.message ?? "send_threw",
        retryable: false,
        deviceGone: false,
      }));
    }

    if (result.ok) {
      succeeded += 1;
      await prisma.pushDeliveryLog
        .create({
          data: {
            userId: n.userId,
            deviceId: d.id,
            category: n.category,
            success: true,
          },
        })
        .catch(() => undefined);
      continue;
    }

    failures.push({ deviceId: d.id, reason: result.reason });
    await prisma.pushDeliveryLog
      .create({
        data: {
          userId: n.userId,
          deviceId: d.id,
          category: n.category,
          success: false,
          failureReason: result.reason,
        },
      })
      .catch(() => undefined);

    if (result.deviceGone) {
      await prisma.notificationDevice.delete({ where: { id: d.id } }).catch(() => undefined);
    }
  }

  return {
    attempted: devices.length,
    succeeded,
    failed: failures.length,
    skipped: null,
    failures,
  };
}

// Best-effort fire-and-forget wrapper used by request handlers. The
// caller doesn't care about the report; we just want never to throw.
export function tryDispatchPush(prisma: PrismaClient, n: PushNotification): void {
  sendPush(prisma, n).catch(() => undefined);
}

// ------- retry worker -------

// Re-attempt pushes that failed in the last 60s (one retry pass per
// cron tick). Skips entries flagged as `apns_not_configured` because
// retrying them is pointless until env is set.
export interface PushRetryReport {
  scannedAt: string;
  retried: number;
  succeeded: number;
  failed: number;
  durationMs: number;
}

export async function runPushRetryOnce(
  prisma: PrismaClient,
  opts: SendPushOptions = {},
): Promise<PushRetryReport> {
  const startedAt = Date.now();
  const scannedAt = new Date();
  const since = new Date(Date.now() - 60_000);
  const stale = await prisma.pushDeliveryLog.findMany({
    where: {
      success: false,
      sentAt: { gt: since },
      failureReason: { notIn: ["apns_not_configured", "BadDeviceToken", "Unregistered"] },
    },
    take: 100,
    orderBy: { sentAt: "asc" },
  });

  let succeeded = 0;
  let failed = 0;
  for (const row of stale) {
    if (!row.deviceId) {
      failed += 1;
      continue;
    }
    const device = await prisma.notificationDevice.findUnique({ where: { id: row.deviceId } });
    if (!device) {
      failed += 1;
      continue;
    }
    const report = await sendPush(
      prisma,
      {
        userId: row.userId,
        category: row.category as PushCategory,
        alert: {
          title: "OpenMatch",
          body: "You have a new notification.",
        },
      },
      opts,
    );
    if (report.succeeded > 0) succeeded += 1;
    else failed += 1;
  }

  return {
    scannedAt: scannedAt.toISOString(),
    retried: stale.length,
    succeeded,
    failed,
    durationMs: Date.now() - startedAt,
  };
}

export const __forTest = {
  isCategoryAllowed,
  classifyFailure,
  DEVICE_FRESHNESS_DAYS,
};
