import type { PrismaClient } from "@prisma/client";
import { env } from "../env.js";

// MON-2 — On-call alerter.
//
// Each check returns an `AlertCandidate` describing what fired. The
// runner persists an AlertFired row per (alertKey) and re-fires only
// when the prior row has been resolved (or never existed). Posts a
// Slack incoming-webhook payload when SLACK_WEBHOOK_URL is set.

export type AlertKind = "error_rate_5m" | "dsa_ack_breach" | "report_queue_age" | "photo_queue_age";

export interface AlertCandidate {
  kind: AlertKind;
  alertKey: string;
  description: string;
  details: Record<string, unknown>;
}

export interface AlertReport {
  scannedAt: string;
  fired: number;
  suppressed: number;
  durationMs: number;
  alerts: Array<{ alertKey: string; description: string; posted: boolean }>;
}

// Thresholds. Tunable from env later; documented here today because
// MON-2 ships them inline. The numbers come from the rounds 3+4 ops
// targets in REPORT_CARD.md.
export const ERROR_RATE_THRESHOLD = 0.05; // 5% over a 5-minute window
export const ERROR_RATE_MIN_TOTAL = 20; // ignore noise when traffic is tiny
export const REPORT_QUEUE_AGE_HOURS = 4;
export const PHOTO_QUEUE_AGE_HOURS = 24;

export async function detectAlerts(prisma: PrismaClient): Promise<AlertCandidate[]> {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
  const hourAgo = new Date(now.getTime() - 60 * 60_000);

  const [errCount, totalCount, breachedNotices, oldestReport, oldestPhoto] = await Promise.all([
    prisma.analyticsEvent.count({
      where: {
        serverTs: { gte: fiveMinAgo },
        eventName: { startsWith: "error." },
      },
    }),
    prisma.analyticsEvent.count({ where: { serverTs: { gte: fiveMinAgo } } }),
    prisma.noticeAndActionReport.findMany({
      where: { slaAckBreachedAt: { gt: hourAgo, not: null } },
      select: { id: true, category: true },
      take: 50,
    }),
    prisma.report.findFirst({
      where: { status: { in: ["open", "reviewing"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true },
    }),
    prisma.profilePhoto.findFirst({
      where: { moderationStatus: "under_review" },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true },
    }),
  ]);

  const out: AlertCandidate[] = [];

  // 5xx error rate.
  if (totalCount >= ERROR_RATE_MIN_TOTAL) {
    const rate = errCount / totalCount;
    if (rate >= ERROR_RATE_THRESHOLD) {
      out.push({
        kind: "error_rate_5m",
        alertKey: "error_rate_5m",
        description: `5xx error rate ${(rate * 100).toFixed(1)}% over last 5 minutes (${errCount}/${totalCount})`,
        details: { errorCount: errCount, totalCount, rate },
      });
    }
  }

  // DSA ack-SLA breaches in the last hour. Re-key per-notice so a single
  // breach pages once, not on every check.
  for (const n of breachedNotices) {
    out.push({
      kind: "dsa_ack_breach",
      alertKey: `dsa_ack_breach:${n.id}`,
      description: `DSA acknowledgement SLA breached for notice ${n.id} (${n.category})`,
      details: { noticeId: n.id, category: n.category },
    });
  }

  // Report queue oldest > 4h.
  if (oldestReport) {
    const ageH = (now.getTime() - oldestReport.createdAt.getTime()) / 3600_000;
    if (ageH > REPORT_QUEUE_AGE_HOURS) {
      out.push({
        kind: "report_queue_age",
        alertKey: "report_queue_age",
        description: `Oldest open report is ${ageH.toFixed(1)} h old (${oldestReport.id})`,
        details: { oldestReportId: oldestReport.id, ageH },
      });
    }
  }

  // Photo queue oldest > 24h.
  if (oldestPhoto) {
    const ageH = (now.getTime() - oldestPhoto.createdAt.getTime()) / 3600_000;
    if (ageH > PHOTO_QUEUE_AGE_HOURS) {
      out.push({
        kind: "photo_queue_age",
        alertKey: "photo_queue_age",
        description: `Oldest photo under review is ${ageH.toFixed(1)} h old (${oldestPhoto.id})`,
        details: { oldestPhotoId: oldestPhoto.id, ageH },
      });
    }
  }

  return out;
}

async function postToSlack(text: string): Promise<boolean> {
  if (!env.SLACK_WEBHOOK_URL) return false;
  try {
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runAlertCheckOnce(prisma: PrismaClient): Promise<AlertReport> {
  const startedAt = Date.now();
  const scannedAt = new Date();
  const candidates = await detectAlerts(prisma);

  const out: AlertReport["alerts"] = [];
  let fired = 0;
  let suppressed = 0;

  for (const c of candidates) {
    // Dedupe: if there's an unresolved AlertFired row with this key,
    // skip. Otherwise insert one and (when configured) post to Slack.
    const open = await prisma.alertFired.findFirst({
      where: { alertKey: c.alertKey, resolvedAt: null },
    });
    if (open) {
      suppressed += 1;
      out.push({ alertKey: c.alertKey, description: c.description, posted: false });
      continue;
    }
    const text = `:rotating_light: ${c.description}`;
    const posted = await postToSlack(text);
    await prisma.alertFired
      .create({
        data: {
          alertKey: c.alertKey,
          details: { ...c.details, kind: c.kind, posted },
        },
      })
      .catch(() => undefined);
    fired += 1;
    out.push({ alertKey: c.alertKey, description: c.description, posted });
  }

  return {
    scannedAt: scannedAt.toISOString(),
    fired,
    suppressed,
    durationMs: Date.now() - startedAt,
    alerts: out,
  };
}

// Mark fired-but-no-longer-true alerts as resolved. Currently the
// quarter-hourly retry path resolves them when the underlying condition
// drops below threshold; callers may invoke `resolveAlertCondition`
// from admin tooling once the situation is handled.
export async function resolveAlertCondition(
  prisma: PrismaClient,
  alertKey: string,
): Promise<{ resolved: number }> {
  const result = await prisma.alertFired.updateMany({
    where: { alertKey, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return { resolved: result.count };
}
