import type { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import { env } from "../env.js";
import { requestContext } from "../lib/request-context.js";
import { pruneOldDeckImpressions } from "../services/discovery.service.js";

// MON-1 — Daily success-digest email worker.
//
// Builds a JSON snapshot of operationally-important counters for the
// previous 24h window and, when SMTP is configured, ships it to the
// ADMIN_ALLOWED_EMAILS list. When SMTP isn't configured we still return
// the JSON so the admin dashboard / runbook can hit the endpoint and
// see the numbers.

export interface DailyDigest {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  // Counters for the 24h window ending at `asOf`.
  signupsToday: number;
  signupsYesterday: number;
  activeUsersTotal: number;
  matchesToday: number;
  messagesToday: number;
  reportsToday: number;
  deletionRequestsToday: number;
  errors5xxToday: number;
  photoQueueSize: number;
  oldestReportAgeHours: number | null;
  oldestNoticeAgeHours: number | null;
  // P95 latency is wired through the same path as the admin timeseries
  // endpoint; null until OPS-4 ships request-log persistence.
  p95LatencyMs: number | null;
}

function dayWindow(asOf: Date): { start: Date; end: Date; prevStart: Date } {
  const end = new Date(asOf);
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const prevStart = new Date(start.getTime() - 24 * 3600 * 1000);
  return { start, end, prevStart };
}

export async function buildDailyDigest(
  prisma: PrismaClient,
  asOf: Date = new Date(),
): Promise<DailyDigest> {
  const { start, end, prevStart } = dayWindow(asOf);

  const [
    signupsToday,
    signupsYesterday,
    activeUsersTotal,
    matchesToday,
    messagesToday,
    reportsToday,
    deletionRequestsToday,
    errors5xxToday,
    photoQueueSize,
    oldestReport,
    oldestNotice,
  ] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.user.count({ where: { createdAt: { gte: prevStart, lt: start } } }),
    prisma.user.count({ where: { status: "active" } }),
    prisma.match.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.message.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.report.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.accountDeletionRequest.count({ where: { requestedAt: { gte: start, lt: end } } }),
    prisma.analyticsEvent.count({
      where: {
        serverTs: { gte: start, lt: end },
        eventName: { startsWith: "error." },
      },
    }),
    prisma.profilePhoto.count({ where: { moderationStatus: "under_review" } }),
    prisma.report.findFirst({
      where: { status: { in: ["open", "reviewing"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.noticeAndActionReport.findFirst({
      where: { acknowledgedAt: null },
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    }),
  ]);

  const oldestReportAgeHours = oldestReport
    ? (asOf.getTime() - oldestReport.createdAt.getTime()) / 3600_000
    : null;
  const oldestNoticeAgeHours = oldestNotice
    ? (asOf.getTime() - oldestNotice.receivedAt.getTime()) / 3600_000
    : null;

  return {
    asOf: asOf.toISOString(),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    signupsToday,
    signupsYesterday,
    activeUsersTotal,
    matchesToday,
    messagesToday,
    reportsToday,
    deletionRequestsToday,
    errors5xxToday,
    photoQueueSize,
    oldestReportAgeHours,
    oldestNoticeAgeHours,
    p95LatencyMs: null,
  };
}

export function formatDigestText(d: DailyDigest): string {
  const trendChar =
    d.signupsToday > d.signupsYesterday ? "▲" : d.signupsToday < d.signupsYesterday ? "▼" : "→";
  return [
    `OpenMatch daily digest — ${d.asOf}`,
    ``,
    `Window: ${d.windowStart} → ${d.windowEnd}`,
    ``,
    `Signups (24h):           ${d.signupsToday}  ${trendChar}  (prev 24h: ${d.signupsYesterday})`,
    `Active users (total):    ${d.activeUsersTotal}`,
    `Matches today:           ${d.matchesToday}`,
    `Messages today:          ${d.messagesToday}`,
    `Reports today:           ${d.reportsToday}`,
    `Deletion requests today: ${d.deletionRequestsToday}`,
    `5xx errors today:        ${d.errors5xxToday}`,
    ``,
    `Photo queue size:        ${d.photoQueueSize}`,
    `Oldest report age (h):   ${d.oldestReportAgeHours?.toFixed(1) ?? "—"}`,
    `Oldest notice age (h):   ${d.oldestNoticeAgeHours?.toFixed(1) ?? "—"}`,
    `P95 latency (ms):        ${d.p95LatencyMs ?? "(awaiting OPS-4)"}`,
  ].join("\n");
}

function recipientsFromEnv(): string[] {
  return env.ADMIN_ALLOWED_EMAILS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface DailyDigestRunReport {
  digest: DailyDigest;
  emailed: boolean;
  recipients: number;
  durationMs: number;
}

export async function runDailyDigestOnce(
  prisma: PrismaClient,
  opts: {
    transport?: nodemailer.Transporter;
    asOf?: Date;
  } = {},
): Promise<DailyDigestRunReport> {
  return requestContext.workerRun("daily-digest", () => runDailyDigestInner(prisma, opts));
}

async function runDailyDigestInner(
  prisma: PrismaClient,
  opts: {
    transport?: nodemailer.Transporter;
    asOf?: Date;
  },
): Promise<DailyDigestRunReport> {
  const startedAt = Date.now();
  // DISC-Q1 — piggy-back on the once-daily cron to prune impression
  // rows older than 30 days. Failure is non-fatal; the table just
  // grows a little until the next run.
  try {
    await pruneOldDeckImpressions(prisma, opts.asOf ?? new Date());
  } catch {
    // swallowed by design — see comment above.
  }
  const digest = await buildDailyDigest(prisma, opts.asOf);
  const recipients = recipientsFromEnv();
  const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_PORT);
  if (!smtpConfigured || recipients.length === 0) {
    return {
      digest,
      emailed: false,
      recipients: recipients.length,
      durationMs: Date.now() - startedAt,
    };
  }

  const transport =
    opts.transport ??
    nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE ?? false,
      auth:
        env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });

  await transport
    .sendMail({
      from: env.SMTP_FROM,
      to: recipients.join(","),
      subject: `OpenMatch daily digest — ${digest.asOf.slice(0, 10)}`,
      text: formatDigestText(digest),
    })
    .catch(() => undefined);

  return {
    digest,
    emailed: true,
    recipients: recipients.length,
    durationMs: Date.now() - startedAt,
  };
}
