import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import {
  issueSession,
  listUserSessions,
  revokeAllUserSessions,
  revokeSession,
  revokeUserSession,
  rotateRefreshToken,
  startEmailLogin,
  verifyEmailLogin,
} from "../services/auth.service.js";

function requestContext(req: FastifyRequest) {
  const ua = (req.headers["user-agent"] as string | undefined) ?? null;
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip;
  return { userAgent: ua, ip };
}

const startSchema = z.object({
  method: z.enum(["email", "apple", "dev"]),
  email: z.string().email().optional(),
  appleIdentityToken: z.string().optional(),
  devUserId: z.string().optional(),
});

const verifySchema = z.object({
  challengeId: z.string(),
  token: z.string(),
});

const refreshSchema = z.object({ refreshToken: z.string() });

// Auth endpoints get tight per-IP rate limits. These exist to slow down
// credential stuffing and email-enumeration probes; they're additive to
// the global limit and intentionally lower than the chat-send limit.
const AUTH_LIMITS = {
  start: { max: 10, timeWindow: "1 minute" },
  verify: { max: 20, timeWindow: "1 minute" },
  refresh: { max: 60, timeWindow: "1 minute" },
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/start", { config: { rateLimit: AUTH_LIMITS.start } }, async (req, reply) => {
    const body = startSchema.parse(req.body);

    // Country gate. We log every screening so the SanctionsScreening
    // table is a complete record of who was blocked and why.
    const decision = app.checkCountry(req);
    const inferred = app.inferCountry(req);
    await app.prisma.sanctionsScreening
      .create({
        data: {
          countryCode: inferred,
          result: decision.allow
            ? "cleared"
            : decision.reason === "sanctions"
              ? "blocked_country"
              : decision.reason === "lgbtq_criminalised"
                ? "blocked_country"
                : "needs_review",
          listsChecked: ["OFAC SDN", "EU Consolidated", "UK OFSI", "ILGA-criminalised"],
          matchDetails: decision.allow
            ? undefined
            : { reason: decision.reason, note: decision.note },
        },
      })
      .catch(() => undefined);
    if (!decision.allow) {
      return reply.code(451).send({
        error: "country_not_supported",
        reason: decision.reason,
        message: decision.note,
      });
    }

    if (body.method === "email") {
      if (!body.email) return reply.code(400).send({ error: "email_required" });
      const result = await startEmailLogin(app.prisma, { email: body.email });
      return reply.send({
        challengeId: result.challengeId,
        message: "Check your email for the sign-in link.",
        devToken: result.devToken,
      });
    }

    if (body.method === "apple") {
      // Apple SIWA is wired but requires real Apple credentials. Returning
      // a clear error in dev so it's obvious why the path fails.
      return reply.code(501).send({
        error: "apple_not_configured",
        message:
          "Configure APPLE_TEAM_ID, APPLE_CLIENT_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY to enable Sign in with Apple.",
      });
    }

    if (body.method === "dev") {
      if (!env.ALLOW_DEV_LOGIN) {
        return reply.code(403).send({ error: "dev_login_disabled" });
      }
      if (!body.devUserId) {
        return reply.code(400).send({ error: "devUserId_required" });
      }
      const user = await app.prisma.user.findUnique({
        where: { id: body.devUserId },
      });
      if (!user) return reply.code(404).send({ error: "user_not_found" });
      const session = await issueSession(
        app.prisma,
        user.id,
        (p) => app.jwt.sign(p),
        requestContext(req),
      );
      return reply.send({ ...session, userId: user.id, isNewUser: false });
    }

    return reply.code(400).send({ error: "unknown_method" });
  });

  app.post("/verify", { config: { rateLimit: AUTH_LIMITS.verify } }, async (req, reply) => {
    const body = verifySchema.parse(req.body);
    const result = await verifyEmailLogin(app.prisma, body);
    const session = await issueSession(
      app.prisma,
      result.userId,
      (p) => app.jwt.sign(p),
      requestContext(req),
    );
    return reply.send({
      ...session,
      userId: result.userId,
      isNewUser: result.isNewUser,
    });
  });

  // Also accept GET so the magic-link in email works in a browser.
  app.get("/verify", { config: { rateLimit: AUTH_LIMITS.verify } }, async (req, reply) => {
    const params = verifySchema.parse(req.query);
    const result = await verifyEmailLogin(app.prisma, params);
    const session = await issueSession(
      app.prisma,
      result.userId,
      (p) => app.jwt.sign(p),
      requestContext(req),
    );
    return reply.send({
      ...session,
      userId: result.userId,
      isNewUser: result.isNewUser,
    });
  });

  app.post("/refresh", { config: { rateLimit: AUTH_LIMITS.refresh } }, async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    const next = await rotateRefreshToken(app.prisma, body.refreshToken, (p) => app.jwt.sign(p), {
      ...requestContext(req),
      logReuse: (userId) => {
        // Security event: a revoked refresh token has been presented.
        // The service has revoked the entire session family for this
        // user. Log loudly; downstream alerting may page on this.
        app.log.warn(
          { event: "auth.refresh_token_reuse", userId, ip: requestContext(req).ip },
          "refresh_token_reuse_detected",
        );
      },
    });
    if (!next) return reply.code(401).send({ error: "invalid_refresh_token" });
    return reply.send(next);
  });

  app.post("/logout", async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    await revokeSession(app.prisma, body.refreshToken);
    return reply.code(204).send();
  });

  // ---- Device session management -------------------------------------
  //
  // Each refresh token is a "session" with UA + IP-hash recorded. The
  // owner of the account can list and revoke any session — a common
  // path is "I lost my phone".

  app.get("/sessions", { preHandler: app.authenticate }, async (req) => {
    return listUserSessions(app.prisma, req.userId!);
  });

  app.delete<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const result = await revokeUserSession(app.prisma, req.userId!, req.params.sessionId);
      if (!result.revoked) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );

  app.post("/sessions/revoke-all", { preHandler: app.authenticate }, async (req, reply) => {
    const result = await revokeAllUserSessions(app.prisma, req.userId!);
    app.log.info(
      { event: "auth.revoke_all_sessions", userId: req.userId, count: result.revokedCount },
      "all_sessions_revoked",
    );
    return reply.send(result);
  });
};
