import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { PERMISSIONS } from "../../lib/admin/permissions.js";

const createAdminSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(200),
  roleNames: z.array(z.string()).default([]),
});

const updateRolesSchema = z.object({
  roleNames: z.array(z.string()),
});

export const adminRoleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticateAdmin);

  // Listing roles is widely useful (the admin UI uses it to render
  // permission tooltips and the "assign role" picker), so it's gated on
  // viewing admin users rather than the manage permission.
  app.get(
    "/roles",
    { preHandler: app.requirePermission(PERMISSIONS.ADMIN_MANAGE_ROLES) },
    async (_req, reply) => {
      const roles = await app.prisma.adminRole.findMany({ orderBy: { name: "asc" } });
      return reply.send({
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          permissions: r.permissions,
        })),
      });
    },
  );

  app.get(
    "/admin-users",
    { preHandler: app.requirePermission(PERMISSIONS.ADMIN_MANAGE_ROLES) },
    async (_req, reply) => {
      const admins = await app.prisma.adminUser.findMany({
        include: { roles: { include: { adminRole: true } } },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({
        admins: admins.map((a) => ({
          id: a.id,
          email: a.email,
          displayName: a.displayName,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
          lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
          roleNames: a.roles.map((r) => r.adminRole.name),
        })),
      });
    },
  );

  app.post(
    "/admin-users",
    { preHandler: app.requirePermission(PERMISSIONS.ADMIN_MANAGE_ROLES) },
    async (req, reply) => {
      const body = createAdminSchema.parse(req.body);
      const principal = req.admin!;
      const existing = await app.prisma.adminUser.findUnique({
        where: { email: body.email.toLowerCase() },
      });
      if (existing) return reply.code(409).send({ error: "already_exists" });
      const roles = await app.prisma.adminRole.findMany({
        where: { name: { in: body.roleNames } },
      });
      const created = await app.prisma.adminUser.create({
        data: {
          email: body.email.toLowerCase(),
          displayName: body.displayName,
          roles: {
            create: roles.map((r) => ({
              adminRoleId: r.id,
              assignedByAdminUserId: principal.adminUserId,
            })),
          },
        },
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "role_changed",
          targetEntityType: "admin_user",
          targetEntityId: created.id,
          metadata: { created: true, roleNames: body.roleNames },
        },
      );
      return reply.code(201).send({ id: created.id, email: created.email });
    },
  );

  app.put<{ Params: { adminUserId: string } }>(
    "/admin-users/:adminUserId/roles",
    { preHandler: app.requirePermission(PERMISSIONS.ADMIN_MANAGE_ROLES) },
    async (req, reply) => {
      const body = updateRolesSchema.parse(req.body);
      const principal = req.admin!;
      // Safety: don't allow removing your own final system_admin role.
      if (req.params.adminUserId === principal.adminUserId) {
        const remainingAdminCount = await app.prisma.adminUser.count({
          where: {
            id: { not: principal.adminUserId },
            status: "active",
            roles: { some: { adminRole: { name: "system_admin" } } },
          },
        });
        const willRemoveSysAdmin = !body.roleNames.includes("system_admin");
        if (willRemoveSysAdmin && remainingAdminCount === 0) {
          return reply.code(409).send({ error: "would_lock_out_system_admin" });
        }
      }
      const roles = await app.prisma.adminRole.findMany({
        where: { name: { in: body.roleNames } },
      });
      await app.prisma.$transaction([
        app.prisma.adminUserRole.deleteMany({
          where: { adminUserId: req.params.adminUserId },
        }),
        app.prisma.adminUserRole.createMany({
          data: roles.map((r) => ({
            adminUserId: req.params.adminUserId,
            adminRoleId: r.id,
            assignedByAdminUserId: principal.adminUserId,
          })),
        }),
      ]);
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "role_changed",
          targetEntityType: "admin_user",
          targetEntityId: req.params.adminUserId,
          metadata: { newRoleNames: body.roleNames },
        },
      );
      return reply.send({ ok: true });
    },
  );
};
