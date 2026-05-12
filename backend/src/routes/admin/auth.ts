import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/admin/audit.js";
import { hashForAudit } from "../../lib/admin/hash.js";
import {
  issueAdminSession,
  revokeAdminSession,
  rotateAdminSession,
  startAdminLogin,
  verifyAdminLogin,
} from "../../services/admin/auth.service.js";

const startSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({
  challengeId: z.string().min(1),
  token: z.string().min(1),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const logoutSchema = z.object({ refreshToken: z.string().min(1) });

export const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  // Stricter bucket than the consumer auth routes: 10/min/IP.
  app.post(
    "/start",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = startSchema.parse(req.body);
      const result = await startAdminLogin(app.prisma, body.email);
      return reply.send(result);
    },
  );

  app.post(
    "/verify",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = verifySchema.parse(req.body);
      try {
        const { adminUserId } = await verifyAdminLogin(app.prisma, body.challengeId, body.token);
        const ipHash = req.ip ? hashForAudit(req.ip) : null;
        const session = await issueAdminSession(
          app.prisma,
          adminUserId,
          (id) => app.signAdminAccessToken(id),
          { userAgent: req.headers["user-agent"] ?? null, ipHash },
        );
        // Look up roles snapshot for the audit row.
        const admin = await app.prisma.adminUser.findUnique({
          where: { id: adminUserId },
          include: { roles: { include: { adminRole: true } } },
        });
        const roles = admin?.roles.map((r) => r.adminRole.name) ?? [];
        await writeAudit(
          app.prisma,
          {
            adminUserId,
            adminRoleSnapshot: roles.join(","),
            ipHash,
            userAgent: req.headers["user-agent"] ?? null,
            requestId: req.id ?? null,
          },
          { eventType: "admin_login" },
        );
        return reply.send({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt.toISOString(),
        });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        return reply.code(e.statusCode ?? 400).send({ error: e.message ?? "invalid" });
      }
    },
  );

  app.post(
    "/refresh",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = refreshSchema.parse(req.body);
      const ipHash = req.ip ? hashForAudit(req.ip) : null;
      const rotated = await rotateAdminSession(
        app.prisma,
        body.refreshToken,
        (id) => app.signAdminAccessToken(id),
        { userAgent: req.headers["user-agent"] ?? null, ipHash },
      );
      if (!rotated) return reply.code(401).send({ error: "invalid_refresh" });
      return reply.send({
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken,
        expiresAt: rotated.expiresAt.toISOString(),
      });
    },
  );

  app.post("/logout", async (req, reply) => {
    const body = logoutSchema.parse(req.body);
    await revokeAdminSession(app.prisma, body.refreshToken);
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: app.authenticateAdmin }, async (req, reply) => {
    const p = req.admin!;
    return reply.send({
      adminUserId: p.adminUserId,
      email: p.email,
      roles: p.roleNames,
      permissions: p.permissions,
    });
  });
};
