import type { FastifyInstance } from "fastify";

import { buildReadySnapshot } from "../routes/health.js";

// Public status-page aggregation. Powers `GET /api/v1/status/public`,
// which the admin Next.js app reads with `cache: 'no-store'` to render
// `/status` for unauthenticated visitors.
//
// Aggregation rules (matches the spec in the PR description):
//   - Pass rate over the last 60 minutes of SyntheticCheckRun rows:
//       > 95 % → "normal"
//       80-95 % → "degraded"
//       < 80 % → "incident"
//   - Per-service uptime over the last 90 days is currently a single
//     row (the synthetic exercises the full backend stack). Future
//     work splits push / realtime / admin into their own probes; the
//     DTO already returns one entry per service so the UI doesn't
//     need to change when that happens.
//   - Recent incidents: every IncidentUpdate posted in the last 7
//     days, grouped by `incidentKey`, with the most recent update
//     per group treated as the current state. Any incident whose
//     latest update is `resolved` shows in the "Resolved" section;
//     anything else is "Active".

export type StatusHeadline = "normal" | "degraded" | "incident" | "unknown";

export interface ServiceSummary {
  key: "backend" | "admin" | "push" | "realtime";
  label: string;
  status: StatusHeadline;
  // 90-day pass rate; null if we don't have data yet for this service.
  uptime90d: number | null;
  // 24-hour pass rate, surfaced separately so the UI can render a
  // "today" tile next to the long-term uptime number.
  uptime24h: number | null;
}

export interface IncidentSummary {
  incidentKey: string;
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  severity: "none" | "minor" | "major" | "critical";
  service: string;
  startedAt: string; // ISO of the FIRST update in the timeline.
  updatedAt: string; // ISO of the MOST RECENT update.
  updates: {
    id: string;
    status: IncidentSummary["status"];
    title: string;
    body: string;
    postedAt: string;
  }[];
}

export interface DailyUptimePoint {
  // YYYY-MM-DD in UTC.
  day: string;
  passRate: number | null; // null on days with zero probes
  passed: number;
  total: number;
}

export interface PublicStatusDTO {
  generatedAt: string;
  headline: StatusHeadline;
  // Short human-readable headline message — derived from the highest-
  // severity active incident if any, otherwise the synthetic pass-rate
  // bucket.
  headlineMessage: string;
  services: ServiceSummary[];
  // 90-day uptime time-series, one entry per UTC day, oldest first.
  uptime90d: DailyUptimePoint[];
  activeIncidents: IncidentSummary[];
  recentResolved: IncidentSummary[]; // last 7 days, resolved
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function bucketFromPassRate(passRate: number | null): StatusHeadline {
  if (passRate === null) return "unknown";
  if (passRate >= 0.95) return "normal";
  if (passRate >= 0.8) return "degraded";
  return "incident";
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeUptimeSeries(
  app: FastifyInstance,
  windowMs: number,
): Promise<{
  pointsByDay: Map<string, { passed: number; total: number }>;
  passRate: number | null;
}> {
  const since = new Date(Date.now() - windowMs);
  const rows = await app.prisma.syntheticCheckRun.findMany({
    where: { ranAt: { gte: since } },
    select: { ranAt: true, passed: true },
    orderBy: { ranAt: "asc" },
  });
  const pointsByDay = new Map<string, { passed: number; total: number }>();
  let totalPassed = 0;
  let total = 0;
  for (const r of rows) {
    const day = isoDay(r.ranAt);
    const cur = pointsByDay.get(day) ?? { passed: 0, total: 0 };
    cur.total += 1;
    if (r.passed) cur.passed += 1;
    pointsByDay.set(day, cur);
    total += 1;
    if (r.passed) totalPassed += 1;
  }
  return {
    pointsByDay,
    passRate: total === 0 ? null : totalPassed / total,
  };
}

function densify(
  pointsByDay: Map<string, { passed: number; total: number }>,
  windowMs: number,
): DailyUptimePoint[] {
  const days = Math.max(1, Math.ceil(windowMs / ONE_DAY_MS));
  const out: DailyUptimePoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * ONE_DAY_MS);
    const key = isoDay(d);
    const cell = pointsByDay.get(key);
    if (cell) {
      out.push({
        day: key,
        passRate: cell.total === 0 ? null : cell.passed / cell.total,
        passed: cell.passed,
        total: cell.total,
      });
    } else {
      out.push({ day: key, passRate: null, passed: 0, total: 0 });
    }
  }
  return out;
}

interface RawIncidentRow {
  id: string;
  incidentKey: string;
  title: string;
  body: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  severity: "none" | "minor" | "major" | "critical";
  service: string;
  postedAt: Date;
}

function groupIncidents(rows: RawIncidentRow[]): {
  active: IncidentSummary[];
  resolved: IncidentSummary[];
} {
  // Group updates by incidentKey. Within each group the rows are
  // ordered ascending so we can pluck `startedAt` (first) and
  // `updatedAt` / current state (last) in one pass.
  const groups = new Map<string, RawIncidentRow[]>();
  for (const r of rows) {
    const cur = groups.get(r.incidentKey) ?? [];
    cur.push(r);
    groups.set(r.incidentKey, cur);
  }
  const active: IncidentSummary[] = [];
  const resolved: IncidentSummary[] = [];
  for (const [key, updates] of groups.entries()) {
    if (updates.length === 0) continue;
    updates.sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
    // Length guard above ensures both are defined; the explicit
    // `!` is purely for TS' control-flow analyser.
    const first = updates[0]!;
    const last = updates[updates.length - 1]!;
    const summary: IncidentSummary = {
      incidentKey: key,
      title: last.title,
      status: last.status,
      severity: last.severity,
      service: last.service,
      startedAt: first.postedAt.toISOString(),
      updatedAt: last.postedAt.toISOString(),
      updates: updates.map((u) => ({
        id: u.id,
        status: u.status,
        title: u.title,
        body: u.body,
        postedAt: u.postedAt.toISOString(),
      })),
    };
    if (last.status === "resolved") {
      resolved.push(summary);
    } else {
      active.push(summary);
    }
  }
  // Most recent updates first within each section.
  active.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  resolved.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { active, resolved };
}

export async function buildPublicStatus(app: FastifyInstance): Promise<PublicStatusDTO> {
  // Last hour pass rate drives the auto-derived headline. Last 24
  // hours and last 90 days feed the service tiles + chart.
  const [hour, day, ninety, ready, incidentRows] = await Promise.all([
    computeUptimeSeries(app, ONE_HOUR_MS),
    computeUptimeSeries(app, ONE_DAY_MS),
    computeUptimeSeries(app, 90 * ONE_DAY_MS),
    buildReadySnapshot(app),
    app.prisma.incidentUpdate.findMany({
      where: { postedAt: { gte: new Date(Date.now() - 7 * ONE_DAY_MS) } },
      orderBy: { postedAt: "asc" },
      select: {
        id: true,
        incidentKey: true,
        title: true,
        body: true,
        status: true,
        severity: true,
        service: true,
        postedAt: true,
      },
    }),
  ]);

  const { active, resolved } = groupIncidents(incidentRows as unknown as RawIncidentRow[]);

  // Headline picks the most pessimistic of:
  //   - synthetic pass-rate bucket (last hour)
  //   - any active incident's severity
  // so an active "minor" incident at least surfaces as "degraded".
  let headline: StatusHeadline = bucketFromPassRate(hour.passRate);
  let headlineMessage = "";
  if (active.length > 0) {
    const mostSevere = active.reduce((acc, inc) => {
      const rank: Record<IncidentSummary["severity"], number> = {
        none: 0,
        minor: 1,
        major: 2,
        critical: 3,
      };
      return rank[inc.severity] > rank[acc.severity] ? inc : acc;
    });
    if (mostSevere.severity === "critical" || mostSevere.severity === "major") {
      headline = "incident";
    } else if (headline === "normal" || headline === "unknown") {
      // Any active incident (even "minor") must surface as at least
      // "degraded" — never leave the headline as "unknown" when we
      // know there's an incident in flight.
      headline = "degraded";
    }
    headlineMessage = `${mostSevere.title}`;
  } else {
    headlineMessage =
      headline === "normal"
        ? "All systems normal"
        : headline === "degraded"
          ? "Degraded performance"
          : headline === "incident"
            ? "Synthetic checks failing"
            : "Status unknown";
  }

  // Per-service summaries. v0 maps each service to the same synthetic
  // pass-rate but tags Ably / Redis / Postgres with the live /ready
  // signal so the tile flips red the moment a dep goes down even
  // before the synthetic next runs.
  const overallStatusFromHour = bucketFromPassRate(hour.passRate);
  const services: ServiceSummary[] = [
    {
      key: "backend",
      label: "Backend API",
      status: overallStatusFromHour,
      uptime90d: ninety.passRate,
      uptime24h: day.passRate,
    },
    {
      key: "admin",
      label: "Admin dashboard",
      status: overallStatusFromHour,
      uptime90d: ninety.passRate,
      uptime24h: day.passRate,
    },
    {
      key: "push",
      label: "Push notifications",
      // Push has no probe today — surface as unknown rather than
      // pretend it's healthy.
      status: "unknown",
      uptime90d: null,
      uptime24h: null,
    },
    {
      key: "realtime",
      label: "Realtime messaging",
      status: ready.checks.ably.configured
        ? ready.checks.ably.ok
          ? overallStatusFromHour
          : "incident"
        : "unknown",
      uptime90d: ready.checks.ably.configured ? ninety.passRate : null,
      uptime24h: ready.checks.ably.configured ? day.passRate : null,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    headline,
    headlineMessage,
    services,
    uptime90d: densify(ninety.pointsByDay, 90 * ONE_DAY_MS),
    activeIncidents: active,
    recentResolved: resolved,
  };
}

// Internal hook for tests: lets a spec exercise the headline-derivation
// logic without hitting Prisma. Not used from route handlers.
export const _statusInternals = {
  bucketFromPassRate,
  groupIncidents,
  densify,
};
