import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";
import { buildInviteCode } from "../../lib/invite-codes.js";

// Admin CRUD for beta invite codes. Generates batches at a time, lets
// trust+safety revoke any code, and lists by cohort + status. Every
// state-changing call writes an AdminAuditLog row.

const listSchema = z.object({
  cohort: z.string().optional(),
  status: z.enum(["active", "revoked", "expired", "exhausted", "all"]).default("all"),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

const createSchema = z.object({
  cohortLabel: z.string().min(1).max(60),
  maxUses: z.coerce.number().int().positive().max(1000).default(1),
  expiresAt: z.string().datetime().optional(),
  count: z.coerce.number().int().positive().max(100).default(1),
  notes: z.string().max(1000).optional(),
});

export const adminInvitesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);
  app.addHook(
    "preHandler",
    app.requireAnyPermission([PERMISSIONS.BETA_INVITE_MANAGE, PERMISSIONS.ADMIN_MANAGE_ROLES]),
  );

  app.get("/", async (req, reply) => {
    const q = listSchema.parse(req.query);
    const now = new Date();
    const where: Record<string, unknown> = {};
    if (q.cohort) where.cohortLabel = q.cohort;
    if (q.status === "active") {
      where.revokedAt = null;
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
    } else if (q.status === "revoked") {
      where.revokedAt = { not: null };
    } else if (q.status === "expired") {
      where.expiresAt = { lt: now };
      where.revokedAt = null;
    }
    const take = q.limit + 1;
    const rows = await app.prisma.betaInviteCode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return reply.send({
      items: items.map((r) => ({
        id: r.id,
        code: r.code,
        cohortLabel: r.cohortLabel,
        maxUses: r.maxUses,
        usedCount: r.usedCount,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        createdByAdminUserId: r.createdByAdminUserId,
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    });
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const principal = req.admin!;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    // Generate unique codes one-at-a-time. Collisions are theoretical
    // (the alphabet × length gives ~30 bits of entropy in the suffix),
    // but we still retry on the unique-violation just in case.
    const created: Awaited<ReturnType<typeof app.prisma.betaInviteCode.create>>[] = [];
    for (let i = 0; i < body.count; i++) {
      let attempts = 0;
      while (true) {
        attempts += 1;
        const code = buildInviteCode(body.cohortLabel);
        try {
          const row = await app.prisma.betaInviteCode.create({
            data: {
              code,
              cohortLabel: body.cohortLabel,
              maxUses: body.maxUses,
              expiresAt,
              notes: body.notes ?? null,
              createdByAdminUserId: principal.adminUserId,
            },
          });
          created.push(row);
          break;
        } catch (err) {
          if (attempts > 5) throw err;
          // Retry on unique-constraint races.
        }
      }
    }

    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "beta_invite_created",
        metadata: {
          cohortLabel: body.cohortLabel,
          count: created.length,
          maxUses: body.maxUses,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      },
    );

    return reply.send({
      items: created.map((r) => ({
        id: r.id,
        code: r.code,
        cohortLabel: r.cohortLabel,
        maxUses: r.maxUses,
        expiresAt: r.expiresAt?.toISOString() ?? null,
      })),
    });
  });

  app.post<{ Params: { id: string } }>("/:id/revoke", async (req, reply) => {
    const principal = req.admin!;
    const existing = await app.prisma.betaInviteCode.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.revokedAt) {
      return reply.send({
        id: existing.id,
        revokedAt: existing.revokedAt.toISOString(),
        alreadyRevoked: true,
      });
    }
    const updated = await app.prisma.betaInviteCode.update({
      where: { id: req.params.id },
      data: { revokedAt: new Date() },
    });
    await writeAudit(
      app.prisma,
      auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
      {
        eventType: "beta_invite_revoked",
        targetEntityType: "beta_invite_code",
        targetEntityId: req.params.id,
        metadata: { code: existing.code, cohortLabel: existing.cohortLabel },
      },
    );
    return reply.send({ id: updated.id, revokedAt: updated.revokedAt?.toISOString() });
  });
};
