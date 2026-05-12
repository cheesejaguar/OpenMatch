import type { FastifyPluginAsync } from "fastify";
import { PERMISSIONS } from "../../lib/admin/permissions.js";

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
};
