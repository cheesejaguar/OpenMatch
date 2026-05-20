import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditContextFromRequest, writeAudit } from "../../lib/admin/audit.js";
import { ErrorCodes } from "../../lib/error-codes.js";
import { httpError, sendHttpError } from "../../lib/http-error.js";
import { notifyAdminSecurityEvent } from "../../services/admin/notifications.js";
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
      // SEV-A1 / SEV-A7: the first-time enrol path only succeeds when
      // the admin has no secret on file. Re-enrolment (replacing the
      // device of an already-enrolled admin) must go through `/reset`,
      // which is gated by `requireAdminTwoFactor` so the caller is
      // already 2FA-elevated. The old silent-overwrite behaviour was a
      // 2FA bypass for any party with magic-link-only access.
      try {
        const result = await enrollTotp(app.prisma, principal.adminUserId);
        await writeAudit(
          app.prisma,
          auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
          { eventType: "admin_totp_enrolled" },
        );
        // Fire out-of-band notification so a takeover always leaves a
        // mail/Slack trail. Best-effort; never fail the response.
        void notifyAdminSecurityEvent({
          email: principal.email,
          kind: "totp_enrolled",
          context: { adminUserId: principal.adminUserId, ip: req.ip ?? null },
        });
        return reply.send({
          otpauthUri: result.otpauthUri,
          recoveryCodes: result.recoveryCodes,
        });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 409 && e.message === "totp_already_enrolled") {
          return reply.code(409).send({ error: "totp_already_enrolled" });
        }
        throw err;
      }
    },
  );

  // SEV-A1 / SEV-A7: explicit reset path for an admin who has lost
  // their device. Gated by `requireAdminTwoFactor`, so the caller must
  // either (a) still possess their authenticator and have elevated via
  // /verify, OR (b) have presented a recovery code via /recover and
  // elevated that way. Both paths require a second factor, closing the
  // magic-link-only takeover primitive. We also notify out-of-band so
  // any reset leaves a side-channel trail.
  app.post(
    "/reset",
    {
      preHandler: [app.authenticateAdmin, app.requireAdminTwoFactor],
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const principal = req.admin!;
      const result = await enrollTotp(app.prisma, principal.adminUserId, {
        allowOverwrite: true,
      });
      await writeAudit(
        app.prisma,
        auditContextFromRequest(req, principal.adminUserId, principal.roleNames),
        { eventType: "admin_totp_reset" },
      );
      void notifyAdminSecurityEvent({
        email: principal.email,
        kind: "totp_reset_requested",
        context: { adminUserId: principal.adminUserId, ip: req.ip ?? null },
      });
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
      if (!ok) return sendHttpError(reply, httpError(ErrorCodes.INVALID_TOTP_CODE));
      if (!principal.sessionId) {
        // The bearer token has no associated session id (helper-minted
        // token). We accept the TOTP code but cannot elevate a session
        // that doesn't exist; the client is expected to re-issue tokens
        // via /auth/verify which now carries `sid` in the claims.
        return sendHttpError(reply, httpError(ErrorCodes.SESSION_MISSING_SID));
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
      if (!result.ok) return sendHttpError(reply, httpError(ErrorCodes.INVALID_RECOVERY_CODE));
      if (!principal.sessionId) {
        return sendHttpError(reply, httpError(ErrorCodes.SESSION_MISSING_SID));
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
      // SEV-A7: notify out-of-band on recovery-code consumption so a
      // takeover via a leaked code leaves an alert trail.
      void notifyAdminSecurityEvent({
        email: principal.email,
        kind: "totp_recovery_used",
        context: {
          adminUserId: principal.adminUserId,
          ip: req.ip ?? null,
          remainingCodes: result.remainingCodes,
        },
      });
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
      // SEV-A7: notify out-of-band on any 2FA removal.
      void notifyAdminSecurityEvent({
        email: principal.email,
        kind: "totp_disabled",
        context: { adminUserId: principal.adminUserId, ip: req.ip ?? null },
      });
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
