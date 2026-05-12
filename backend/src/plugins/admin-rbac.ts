import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { auditContextFromRequest, writeAudit } from "../lib/admin/audit.js";
import type { Permission } from "../lib/admin/permissions.js";

declare module "fastify" {
  interface FastifyInstance {
    requirePermission: (
      perm: Permission,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAnyPermission: (
      perms: Permission[],
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// All access-denied paths emit an audit row so an auditor can later see
// who tried to do what. PRD §6.2.

export default fp(async (app) => {
  app.decorate("requirePermission", (perm: Permission) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const principal = req.admin;
      if (!principal) return reply.code(401).send({ error: "unauthorized" });
      if (!principal.permissions.includes(perm)) {
        await writeAudit(
          app.prisma,
          auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
          {
            eventType: "access_denied",
            metadata: { route: req.routeOptions.url, method: req.method, permission: perm },
          },
        );
        return reply.code(403).send({ error: "forbidden", required: perm });
      }
    };
  });

  app.decorate("requireAnyPermission", (perms: Permission[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const principal = req.admin;
      if (!principal) return reply.code(401).send({ error: "unauthorized" });
      if (!perms.some((p) => principal.permissions.includes(p))) {
        await writeAudit(
          app.prisma,
          auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
          {
            eventType: "access_denied",
            metadata: {
              route: req.routeOptions.url,
              method: req.method,
              permissionsAnyOf: perms,
            },
          },
        );
        return reply.code(403).send({ error: "forbidden", requiredAnyOf: perms });
      }
    };
  });
});
