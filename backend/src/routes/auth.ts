import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { verifyAppleIdentityToken } from "../services/apple-auth.service.js";
import {
  issueSession,
  listUserSessions,
  revokeAllUserSessions,
  revokeSession,
  revokeUserSession,
  rotateRefreshToken,
  startEmailLogin,
  upsertAppleUser,
  verifyEmailLogin,
} from "../services/auth.service.js";

function requestContext(req: FastifyRequest) {
  const ua = (req.headers["user-agent"] as string | undefined) ?? null;
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip;
  return { userAgent: ua, ip };
}

// Runs the country gate, logs a SanctionsScreening row for the sanctions
// and LGBTQ-safety reasons (not for the "unsupported" launch-geography
// reason — that's a launch decision, not a sanctions match), and sends
// a 451 if the request is blocked. Returns true iff the request should
// continue.
async function enforceCountryGate(
  app: FastifyRequest["server"],
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const decision = app.checkCountry(req);
  if (decision.allow) return true;
  const inferred = app.inferCountry(req);
  if (decision.reason === "sanctions" || decision.reason === "lgbtq_criminalised") {
    await app.prisma.sanctionsScreening
      .create({
        data: {
          countryCode: inferred,
          result: "blocked_country",
          listsChecked: ["OFAC SDN", "EU Consolidated", "UK OFSI", "ILGA-criminalised"],
          matchDetails: { reason: decision.reason, note: decision.note },
        },
      })
      .catch(() => undefined);
  } else {
    // "unsupported" — launch-geography decision, not a screening match.
    // Log it but don't pollute the SanctionsScreening table.
    app.log.info(
      { event: "country.unsupported_geography", country: inferred },
      "blocked_unsupported_geography",
    );
  }
  reply.code(451).send({
    error: "country_not_supported",
    reason: decision.reason,
    message: decision.note,
  });
  return false;
}

const declaredLocationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .optional();

const startSchema = z.object({
  method: z.enum(["email", "apple", "dev"]),
  email: z.string().email().optional(),
  appleIdentityToken: z.string().optional(),
  devUserId: z.string().optional(),
  inviteCode: z.string().min(1).max(64).optional(),
  declaredLocation: declaredLocationSchema,
});

const verifySchema = z.object({
  challengeId: z.string(),
  token: z.string(),
  inviteCode: z.string().min(1).max(64).optional(),
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
    if (!(await enforceCountryGate(app, req, reply))) return;

    // Operational kill switch: signups paused. New AND returning users
    // get a 503 so iOS surfaces a banner. (Returning users could be
    // exempted, but keeping the rule simple makes the operator's mental
    // model easier.)
    if (await app.flags.evaluate("signups_paused")) {
      return reply.code(503).send({ error: "signups_paused" });
    }

    // Metro gate: only enforced on the write paths. If iOS sent
    // declaredLocation, ensure it falls inside an active metro for the
    // inferred country.
    if (body.declaredLocation) {
      const metro = await app.checkMetro(req, { location: body.declaredLocation });
      if (!metro.allow) {
        return reply.code(451).send({
          error: "outside_metro",
          message:
            "OpenMatch is opening one metro at a time. Join the waitlist to be notified when we expand.",
          nearestKm: metro.nearestKm,
        });
      }
    }

    const inviteRequired = await app.flags.evaluate("invite_required");

    if (body.method === "email") {
      if (!body.email) return reply.code(400).send({ error: "email_required" });
      // Email magic-link flow: validation of the invite happens at
      // /verify time (when the User is actually created). We do an
      // early-reject here purely as a UX courtesy so testers don't get
      // an email for a doomed flow.
      if (inviteRequired && body.inviteCode) {
        const normalized = body.inviteCode.trim().toUpperCase();
        const row = await app.prisma.betaInviteCode.findUnique({ where: { code: normalized } });
        if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) {
          return reply.code(400).send({ error: "invite_invalid" });
        }
        if (row.usedCount >= row.maxUses) {
          return reply.code(409).send({ error: "invite_exhausted" });
        }
      }
      const result = await startEmailLogin(app.prisma, { email: body.email });
      return reply.send({
        challengeId: result.challengeId,
        message: "Check your email for the sign-in link.",
        devToken: result.devToken,
        inviteRequired,
      });
    }

    if (body.method === "apple") {
      if (!body.appleIdentityToken) {
        return reply.code(400).send({ error: "appleIdentityToken_required" });
      }
      try {
        const identity = await verifyAppleIdentityToken(body.appleIdentityToken);
        const { user, isNewUser } = await upsertAppleUser(app.prisma, identity, {
          inviteRequired,
          inviteCode: body.inviteCode ?? null,
        });
        const session = await issueSession(app.prisma, user.id, (p) => app.jwt.sign(p));
        return reply.send({ ...session, userId: user.id, isNewUser });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 501) {
          return reply.code(501).send({
            error: "apple_not_configured",
            message:
              "Configure APPLE_TEAM_ID, APPLE_CLIENT_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY to enable Sign in with Apple.",
          });
        }
        if (e.statusCode === 400 || e.statusCode === 409) {
          return reply.code(e.statusCode).send({
            error: e.message ?? "invite_invalid",
          });
        }
        return reply.code(401).send({
          error: "apple_verification_failed",
          message: err instanceof Error ? err.message : "invalid_identity_token",
        });
      }
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
      // Dev login resolves to an existing user (returning sign-in), so
      // the new-user invite gate normally wouldn't apply. We still
      // honour an explicit `DEV_LOGIN_BYPASSES_INVITE=false` for tests
      // that want to exercise the gated path end-to-end.
      if (inviteRequired && !env.DEV_LOGIN_BYPASSES_INVITE && !body.inviteCode) {
        return reply.code(400).send({ error: "invite_code_required" });
      }
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
    if (!(await enforceCountryGate(app, req, reply))) return;
    const body = verifySchema.parse(req.body);
    const inviteRequired = await app.flags.evaluate("invite_required");
    try {
      const result = await verifyEmailLogin(app.prisma, body, { inviteRequired });
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
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400 || e.statusCode === 409) {
        return reply.code(e.statusCode).send({ error: e.message ?? "invalid_request" });
      }
      throw err;
    }
  });

  // Also accept GET so the magic-link in email works in a browser.
  app.get("/verify", { config: { rateLimit: AUTH_LIMITS.verify } }, async (req, reply) => {
    if (!(await enforceCountryGate(app, req, reply))) return;
    const params = verifySchema.parse(req.query);
    const inviteRequired = await app.flags.evaluate("invite_required");
    try {
      const result = await verifyEmailLogin(app.prisma, params, { inviteRequired });
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
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400 || e.statusCode === 409) {
        return reply.code(e.statusCode).send({ error: e.message ?? "invalid_request" });
      }
      throw err;
    }
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
