import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "../../lib/admin/permissions.js";

// ADMIN-2 analytics: funnel + retention + per-metric timeseries.
//
// The funnel mixes two data sources because some events only the iOS
// client knows ("signup.email_started") and some only the server can
// confirm ("user row created", "first Match"). Steps that exist purely
// on the server side go through the DB; steps that originate on the
// client are reconstructed from AnalyticsEvent.
//
// Cohort filtering joins through BetaInviteRedemption →
// BetaInviteCode.cohortLabel. Users without a redemption row are
// always excluded from cohort-scoped queries.

const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cohort: z.string().min(1).max(60).optional(),
});

const timeseriesSchema = dateRangeSchema.extend({
  metric: z.enum(["signups", "matches", "messages"]).default("signups"),
  granularity: z.enum(["hour", "day"]).default("day"),
});

function resolveRange(input: { from?: string; to?: string }): { from: Date; to: Date } {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 30 * 24 * 3600_000);
  return { from, to };
}

// Pull the set of userIds belonging to a cohort. Returns null if no
// cohort filter is active so callers can skip the IN-clause.
async function cohortUserIds(
  prisma: import("@prisma/client").PrismaClient,
  cohort: string | undefined,
): Promise<string[] | null> {
  if (!cohort) return null;
  const rows = await prisma.betaInviteRedemption.findMany({
    where: { inviteCode: { cohortLabel: cohort } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export const adminAnalyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);
  app.addHook("preHandler", app.requirePermission(PERMISSIONS.METRICS_READ));

  // ---- Funnel ----------------------------------------------------------

  app.get("/funnel", async (req, reply) => {
    const q = dateRangeSchema.parse(req.query);
    const { from, to } = resolveRange(q);
    const cohortIds = await cohortUserIds(app.prisma, q.cohort);
    // If a cohort is requested but no one redeemed, every step is 0.
    if (cohortIds && cohortIds.length === 0) {
      return reply.send({
        from: from.toISOString(),
        to: to.toISOString(),
        cohort: q.cohort,
        steps: emptyFunnel(),
      });
    }

    const userFilter = cohortIds ? { userId: { in: cohortIds } } : {};
    const userIdSetFilter = cohortIds ? { id: { in: cohortIds } } : {};
    const timeRange = { gte: from, lte: to };

    // Step 1: app_opened — distinct users
    const appOpened = await app.prisma.analyticsEvent.findMany({
      where: { eventName: "app_opened", serverTs: timeRange, ...userFilter },
      select: { userId: true },
      distinct: ["userId"],
    });
    const appOpenedCount = appOpened.filter((e) => e.userId).length;

    // Step 2: signup started
    const signupStarted = await app.prisma.analyticsEvent.findMany({
      where: {
        eventName: { in: ["signup.email_started", "signup.apple_started"] },
        serverTs: timeRange,
        ...userFilter,
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    // Step 3: signup completed
    const signupCompleted = await app.prisma.analyticsEvent.findMany({
      where: {
        eventName: { in: ["signup.email_verified", "signup.apple_completed"] },
        serverTs: timeRange,
        ...userFilter,
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    // Step 4: user row created (server-side)
    const userCreated = await app.prisma.user.count({
      where: { createdAt: timeRange, ...userIdSetFilter },
    });

    // Step 5: onboarding completed (client-side)
    const onboardingCompleted = await app.prisma.analyticsEvent.findMany({
      where: { eventName: "onboarding.completed", serverTs: timeRange, ...userFilter },
      select: { userId: true },
      distinct: ["userId"],
    });

    // Step 6: first swipe (client-side or server-side — use server-side
    // SwipeAction so we're robust to client-event loss)
    const firstSwipeGroup = await app.prisma.swipeAction.groupBy({
      by: ["viewerUserId"],
      where: {
        createdAt: timeRange,
        ...(cohortIds ? { viewerUserId: { in: cohortIds } } : {}),
      },
      _count: { _all: true },
    });

    // Step 7: first match (server-side)
    const firstMatchUsers = new Set<string>();
    const matches = await app.prisma.match.findMany({
      where: { createdAt: timeRange },
      select: { userAId: true, userBId: true },
    });
    for (const m of matches) {
      if (!cohortIds || cohortIds.includes(m.userAId)) firstMatchUsers.add(m.userAId);
      if (!cohortIds || cohortIds.includes(m.userBId)) firstMatchUsers.add(m.userBId);
    }

    // Step 8: first message sent (server-side)
    const firstMsgGroup = await app.prisma.message.groupBy({
      by: ["senderUserId"],
      where: {
        createdAt: timeRange,
        ...(cohortIds ? { senderUserId: { in: cohortIds } } : {}),
      },
      _count: { _all: true },
    });

    const steps = buildFunnel([
      { name: "app_opened", count: appOpenedCount },
      { name: "signup_started", count: signupStarted.filter((e) => e.userId).length },
      { name: "signup_completed", count: signupCompleted.filter((e) => e.userId).length },
      { name: "user_created", count: userCreated },
      {
        name: "onboarding_completed",
        count: onboardingCompleted.filter((e) => e.userId).length,
      },
      { name: "first_swipe", count: firstSwipeGroup.length },
      { name: "first_match", count: firstMatchUsers.size },
      { name: "first_message", count: firstMsgGroup.length },
    ]);

    return reply.send({
      from: from.toISOString(),
      to: to.toISOString(),
      cohort: q.cohort ?? null,
      steps,
    });
  });

  // ---- Retention -------------------------------------------------------
  //
  // For each "signup day" within [from, to], compute the fraction of
  // those users who logged any activity (AnalyticsEvent OR Session
  // creation OR a swipe) on D+1, D+7, D+30.

  app.get("/retention", async (req, reply) => {
    const q = dateRangeSchema.parse(req.query);
    const { from, to } = resolveRange(q);
    const cohortIds = await cohortUserIds(app.prisma, q.cohort);
    if (cohortIds && cohortIds.length === 0) {
      return reply.send({
        from: from.toISOString(),
        to: to.toISOString(),
        cohort: q.cohort,
        cohorts: [],
      });
    }
    const users = await app.prisma.user.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(cohortIds ? { id: { in: cohortIds } } : {}),
      },
      select: { id: true, createdAt: true },
    });

    // Group by signup day (UTC date).
    const byDay = new Map<string, string[]>();
    for (const u of users) {
      const dayKey = u.createdAt.toISOString().slice(0, 10);
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(u.id);
    }

    const out: Array<{
      signupDate: string;
      cohortSize: number;
      d1: number | null;
      d7: number | null;
      d30: number | null;
    }> = [];
    for (const [day, userIds] of byDay) {
      const dayStart = new Date(`${day}T00:00:00.000Z`);
      const cohortSize = userIds.length;
      const ret = async (offsetDays: number): Promise<number | null> => {
        const windowStart = new Date(dayStart.getTime() + offsetDays * 86_400_000);
        const windowEnd = new Date(windowStart.getTime() + 86_400_000);
        // Skip future windows (no data yet).
        if (windowStart.getTime() > Date.now()) return null;
        const events = await app.prisma.analyticsEvent.findMany({
          where: {
            userId: { in: userIds },
            serverTs: { gte: windowStart, lt: windowEnd },
          },
          select: { userId: true },
          distinct: ["userId"],
        });
        return cohortSize > 0 ? events.length / cohortSize : 0;
      };
      out.push({
        signupDate: day,
        cohortSize,
        d1: await ret(1),
        d7: await ret(7),
        d30: await ret(30),
      });
    }
    out.sort((a, b) => a.signupDate.localeCompare(b.signupDate));

    return reply.send({
      from: from.toISOString(),
      to: to.toISOString(),
      cohort: q.cohort ?? null,
      cohorts: out,
    });
  });

  // ---- Timeseries ------------------------------------------------------

  app.get("/timeseries", async (req, reply) => {
    const q = timeseriesSchema.parse(req.query);
    const { from, to } = resolveRange(q);
    const cohortIds = await cohortUserIds(app.prisma, q.cohort);
    if (cohortIds && cohortIds.length === 0) {
      return reply.send({
        metric: q.metric,
        granularity: q.granularity,
        from: from.toISOString(),
        to: to.toISOString(),
        cohort: q.cohort,
        points: [],
      });
    }
    const trunc = q.granularity === "day" ? "day" : "hour";

    type Bucket = { bucket: Date; count: bigint };
    let rows: Bucket[] = [];
    if (q.metric === "signups") {
      const cohortClause = cohortIds ? `AND "id" = ANY($3::text[])` : "";
      const params: unknown[] = [from, to];
      if (cohortIds) params.push(cohortIds);
      rows = await app.prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT date_trunc('${trunc}', "createdAt") AS bucket, COUNT(*)::bigint AS count
         FROM "User"
         WHERE "createdAt" >= $1 AND "createdAt" < $2 ${cohortClause}
         GROUP BY bucket ORDER BY bucket ASC`,
        ...params,
      );
    } else if (q.metric === "matches") {
      const cohortClause = cohortIds
        ? `AND ("userAId" = ANY($3::text[]) OR "userBId" = ANY($3::text[]))`
        : "";
      const params: unknown[] = [from, to];
      if (cohortIds) params.push(cohortIds);
      rows = await app.prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT date_trunc('${trunc}', "createdAt") AS bucket, COUNT(*)::bigint AS count
         FROM "Match"
         WHERE "createdAt" >= $1 AND "createdAt" < $2 ${cohortClause}
         GROUP BY bucket ORDER BY bucket ASC`,
        ...params,
      );
    } else {
      const cohortClause = cohortIds ? `AND "senderUserId" = ANY($3::text[])` : "";
      const params: unknown[] = [from, to];
      if (cohortIds) params.push(cohortIds);
      rows = await app.prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT date_trunc('${trunc}', "createdAt") AS bucket, COUNT(*)::bigint AS count
         FROM "Message"
         WHERE "createdAt" >= $1 AND "createdAt" < $2 ${cohortClause}
         GROUP BY bucket ORDER BY bucket ASC`,
        ...params,
      );
    }

    return reply.send({
      metric: q.metric,
      granularity: q.granularity,
      from: from.toISOString(),
      to: to.toISOString(),
      cohort: q.cohort ?? null,
      points: rows.map((r) => ({ t: new Date(r.bucket).toISOString(), v: Number(r.count) })),
    });
  });
};

function emptyFunnel() {
  return buildFunnel([
    { name: "app_opened", count: 0 },
    { name: "signup_started", count: 0 },
    { name: "signup_completed", count: 0 },
    { name: "user_created", count: 0 },
    { name: "onboarding_completed", count: 0 },
    { name: "first_swipe", count: 0 },
    { name: "first_match", count: 0 },
    { name: "first_message", count: 0 },
  ]);
}

function buildFunnel(
  steps: Array<{ name: string; count: number }>,
): Array<{ name: string; count: number; conversionFromPrior: number | null }> {
  const out: Array<{ name: string; count: number; conversionFromPrior: number | null }> = [];
  let prev: number | null = null;
  for (const s of steps) {
    let conv: number | null = null;
    if (prev !== null) {
      conv = prev > 0 ? s.count / prev : 0;
    }
    out.push({ name: s.name, count: s.count, conversionFromPrior: conv });
    prev = s.count;
  }
  return out;
}
