import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "../../lib/admin/permissions.js";

// Admin view onto the BETA-3 waitlist. The public endpoint only stores
// the SHA-256 email hash, so the admin list returns hash + country +
// city — never a recoverable address.

const listSchema = z.object({
  country: z.string().min(2).max(2).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  cursor: z.string().optional(),
});

export const adminWaitlistRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook("preHandler", app.requireAdminTwoFactor);
  app.addHook(
    "preHandler",
    app.requireAnyPermission([PERMISSIONS.METRICS_READ, PERMISSIONS.BETA_INVITE_MANAGE]),
  );

  app.get("/", async (req, reply) => {
    const q = listSchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.country) where.country = q.country.toUpperCase();

    const take = q.limit + 1;
    const rows = await app.prisma.waitlistEntry.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const items = (hasMore ? rows.slice(0, q.limit) : rows).map((r) => ({
      id: r.id,
      emailHash: r.emailHash,
      country: r.country,
      city: r.city,
      createdAt: r.createdAt.toISOString(),
    }));
    const total = await app.prisma.waitlistEntry.count({ where });
    return reply.send({
      items,
      total,
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    });
  });
};
