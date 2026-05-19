import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import {
  consumeRecoveryCode,
  disableTotp,
  elevateAdminSession,
  enrollTotp,
  verifyTotpCode,
} from "../../services/admin/totp.service.js";

// ADMIN-9: TOTP 2FA endpoints.
//
// The enrol/verify/recover routes only require a valid admin JWT (they
// are reachable post-magic-link, before the session is elevated). The
// disable route additionally requires an elevated (twoFactorAt !== null)
// session — once enrolled, removing 2FA must itself pass 2FA.

const codeSchema = z.object({ code: z.string().min(1).max(16) });
const recoverySchema = z.object({ recoveryCode: z.string().min(1).max(32) });

export const adminTotpRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/enroll",
    {
      preHandler: app.authenticateAdmin,
      config: { rateLimit: { max: 30, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const principal = req.admin!;
      // We deliberately allow re-enrolment: if an admin loses their
      // device they may need to start over. Each enrol fully replaces
      // the previous secret + recovery codes, so the old TOTP entry in
      // their authenticator app stops working.
      const result = await enrollTotp(app.prisma, principal.adminUserId);
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        { eventType: "admin_totp_enrolled" },
      );
      return reply.send({
        otpauthUri: result.otpauthUri,
        recoveryCodes: result.recoveryCodes,
      });
    },
  );

  app.post(
    "/verify",
    {
      preHandler: app.authenticateAdmin,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const principal = req.admin!;
      const body = codeSchema.parse(req.body);
      const ok = await verifyTotpCode(app.prisma, principal.adminUserId, body.code);
      if (!ok) return reply.code(401).send({ error: "invalid_totp_code" });
      if (!principal.sessionId) {
        // The bearer token has no associated session id (helper-minted
        // token). We accept the TOTP code but cannot elevate a session
        // that doesn't exist; the client is expected to re-issue tokens
        // via /auth/verify which now carries `sid` in the claims.
        return reply.code(409).send({ error: "session_missing_sid" });
      }
      await elevateAdminSession(app.prisma, principal.sessionId);
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        { eventType: "admin_totp_verified" },
      );
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/recover",
    {
      preHandler: app.authenticateAdmin,
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const principal = req.admin!;
      const body = recoverySchema.parse(req.body);
      const result = await consumeRecoveryCode(
        app.prisma,
        principal.adminUserId,
        body.recoveryCode,
      );
      if (!result.ok) return reply.code(401).send({ error: "invalid_recovery_code" });
      if (!principal.sessionId) {
        return reply.code(409).send({ error: "session_missing_sid" });
      }
      await elevateAdminSession(app.prisma, principal.sessionId);
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        {
          eventType: "admin_recovery_code_used",
          metadata: { remainingCodes: result.remainingCodes },
        },
      );
      return reply.send({ ok: true, remainingCodes: result.remainingCodes });
    },
  );

  app.post(
    "/disable",
    {
      preHandler: [app.authenticateAdmin, app.requireAdminTwoFactor],
    },
    async (req, reply) => {
      const principal = req.admin!;
      await disableTotp(app.prisma, principal.adminUserId);
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        { eventType: "admin_totp_disabled" },
      );
      return reply.send({ ok: true });
    },
  );

  app.get("/status", { preHandler: app.authenticateAdmin }, async (req, reply) => {
    const principal = req.admin!;
    return reply.send({
      enrolled: principal.totpEnrolledAt !== null,
      twoFactorAt: principal.twoFactorAt?.toISOString() ?? null,
      twoFactorRequired: principal.twoFactorRequired,
    });
  });
};
