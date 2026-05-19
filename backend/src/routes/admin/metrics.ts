import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { buildReadySnapshot } from "../health.js";

export const adminMetricsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.METRICS_READ));

  app.get("/overview", async (_req, reply) => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      openReports,
      reportsByReason,
      newUsers24h,
      bannedToday,
      suspended,
      photosUnderReview,
      escalated,
      actionsToday,
      avgAgeRows,
    ] = await Promise.all([
      app.prisma.report.count({ where: { status: "open" } }),
      app.prisma.report.groupBy({
        by: ["reason"],
        where: { status: "open" },
        _count: { _all: true },
      }),
      app.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      app.prisma.userBan.count({
        where: { bannedAt: { gte: todayStart }, banType: { in: ["permanent", "safety_hold"] } },
      }),
      app.prisma.userBan.count({ where: { status: "active", banType: "temporary" } }),
      app.prisma.profilePhoto.count({ where: { moderationStatus: "under_review" } }),
      app.prisma.report.count({ where: { status: "reviewing" } }),
      app.prisma.adminAuditLog.count({ where: { createdAt: { gte: todayStart } } }),
      app.prisma.$queryRaw<{ avg_hours: number | null }[]>`
        SELECT EXTRACT(EPOCH FROM AVG(NOW() - "createdAt")) / 3600 AS avg_hours
        FROM "Report"
        WHERE "status" IN ('open', 'reviewing')
      `,
    ]);
    return reply.send({
      openReports,
      reportsByReason: reportsByReason.map((r) => ({
        reason: r.reason,
        count: r._count._all,
      })),
      averageOpenReportAgeHours: avgAgeRows[0]?.avg_hours ?? null,
      newUsers24h,
      bannedToday,
      activeSuspensions: suspended,
      photoModerationQueue: photosUnderReview,
      escalatedReports: escalated,
      adminActionsToday: actionsToday,
    });
  });

  // ADMIN-1 health panel data source. The admin dashboard reads this
  // every ~10 s and renders the tiles. Includes:
  //   - the same dependency check matrix as /ready
  //   - Postgres pool snapshot from pg_stat_activity
  //   - rolling 5-minute error rate inferred from AnalyticsEvent rows
  //     whose name starts with "error." (server-emitted errors). The
  //     iOS client sends some of these via the analytics pipe.
  //   - moderation/dsa queue depths
  app.get("/health/snapshot", async (_req, reply) => {
    const ready = await buildReadySnapshot(app);

    // Postgres pool stats — best-effort. The "pool" here is whatever
    // pgbouncer + the Prisma adapter is doing at the database side;
    // we report the application-visible connection counts.
    let pgPool: {
      maxConnections: number | null;
      activeConnections: number | null;
      idleConnections: number | null;
    } = { maxConnections: null, activeConnections: null, idleConnections: null };
    try {
      const settings = await app.prisma.$queryRawUnsafe<{ setting: string }[]>(
        `SELECT setting FROM pg_settings WHERE name = 'max_connections'`,
      );
      const activity = await app.prisma.$queryRawUnsafe<{ state: string; count: bigint }[]>(
        `SELECT state, COUNT(*)::bigint AS count FROM pg_stat_activity GROUP BY state`,
      );
      const activeRow = activity.find((a) => a.state === "active");
      const idleRow = activity.find((a) => a.state === "idle");
      pgPool = {
        maxConnections: settings[0]?.setting ? Number.parseInt(settings[0].setting, 10) : null,
        activeConnections: activeRow ? Number(activeRow.count) : 0,
        idleConnections: idleRow ? Number(idleRow.count) : 0,
      };
    } catch {
      // Some managed Postgres setups (Neon serverless on cold-start)
      // can refuse pg_stat_activity reads. Treat as "not available"
      // rather than failing the snapshot.
    }

    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    const [errorCount, totalCount, reportsOpen, photosPending, dsaUnack] = await Promise.all([
      app.prisma.analyticsEvent.count({
        where: {
          serverTs: { gte: fiveMinAgo },
          eventName: { startsWith: "error." },
        },
      }),
      app.prisma.analyticsEvent.count({ where: { serverTs: { gte: fiveMinAgo } } }),
      app.prisma.report.count({ where: { status: { in: ["open", "reviewing"] } } }),
      app.prisma.profilePhoto.count({ where: { moderationStatus: "under_review" } }),
      app.prisma.noticeAndActionReport.count({ where: { acknowledgedAt: null } }),
    ]);
    const errorRate5m = totalCount > 0 ? errorCount / totalCount : null;

    return reply.send({
      ready,
      postgres: {
        ...pgPool,
        // Pool usage as a fraction so the UI can render a gauge
        // without doing the division. Null when max is unknown.
        poolUsage:
          pgPool.maxConnections && pgPool.activeConnections !== null
            ? pgPool.activeConnections / pgPool.maxConnections
            : null,
      },
      errorRate5m,
      queueDepths: {
        reportsOpen,
        photosPending,
        dsaNoticesUnack: dsaUnack,
      },
    });
  });

  // OPS-6 timeseries endpoint. v0 uses AnalyticsEvent as the source for
  // requests / errors / latency because we don't yet ship a dedicated
  // request log to the DB — that's the (future) OPS-4 piece. Once a
  // request log exists, swap the queries here.
  app.get("/timeseries", async (req, reply) => {
    const q = z
      .object({
        metric: z.enum(["requests", "errors", "p95_latency"]).default("requests"),
        granularity: z.enum(["hour", "day"]).default("hour"),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      })
      .parse(req.query);
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3600_000);
    const trunc = q.granularity === "day" ? "day" : "hour";

    if (q.metric === "p95_latency") {
      // We don't have request-latency data in the DB yet. Return an
      // empty series so the admin UI can render a "data not available"
      // state explicitly rather than crashing.
      return reply.send({
        metric: q.metric,
        granularity: q.granularity,
        from: from.toISOString(),
        to: to.toISOString(),
        points: [],
        note: "p95 latency requires the OPS-4 request log; not yet shipped.",
      });
    }

    const whereName = q.metric === "errors" ? `AND "eventName" LIKE 'error.%'` : "";
    const rows = await app.prisma.$queryRawUnsafe<{ bucket: Date; count: bigint }[]>(
      `SELECT date_trunc('${trunc}', "serverTs") AS bucket, COUNT(*)::bigint AS count
       FROM "AnalyticsEvent"
       WHERE "serverTs" >= $1 AND "serverTs" < $2 ${whereName}
       GROUP BY bucket
       ORDER BY bucket ASC`,
      from,
      to,
    );
    return reply.send({
      metric: q.metric,
      granularity: q.granularity,
      from: from.toISOString(),
      to: to.toISOString(),
      points: rows.map((r) => ({
        t: new Date(r.bucket).toISOString(),
        v: Number(r.count),
      })),
    });
  });
};
