import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../env.js";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
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
  // SEV-V5 — the manual XFF parse trusted any client-supplied
  // `X-Forwarded-For` header verbatim, letting an attacker pin their
  // `ipHash` / rate-limit bucket to a value of their choice on the
  // dev-login path. `req.ip` already reflects the validated upstream
  // IP via Fastify's `trustProxy` machinery (configured to true in
  // non-test envs), so we strip the redundant parsing in favour of it.
  return { userAgent: ua, ip: req.ip ?? null };
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
  const err = httpError(ErrorCodes.COUNTRY_NOT_SUPPORTED, {
    message: decision.note ?? undefined,
    details: { reason: decision.reason },
  });
  reply.code(err.statusCode).send(err.body);
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
  // SEV-M5: raw (unhashed) nonce the iOS client used in its
  // ASAuthorizationAppleIDRequest. Server SHA-256s it and compares to
  // the `nonce` claim in the identity token. Required when
  // env.APPLE_NONCE_REQUIRED is true; optional otherwise (legacy clients).
  appleNonce: z.string().min(8).max(256).optional(),
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

// Round A — DTO contracts for the /refresh response. These mirror the
// shape `rotateRefreshToken` returns. iOS depends on this exact set of
// fields; locking it in a Fastify response schema means any future
// drift fails CI rather than the on-device JSON decoder. `expiresAt`
// is a JS Date in-memory but JSON-serialises to an ISO string; the
// Zod `coerce` flag accepts both representations during validation.
const sessionTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.union([z.string(), z.date()]),
});

// Auth endpoints get tight per-IP rate limits. These exist to slow down
// credential stuffing and email-enumeration probes; they're additive to
// the global limit and intentionally lower than the chat-send limit.
const AUTH_LIMITS = {
  start: { max: 10, timeWindow: "1 minute" },
  verify: { max: 20, timeWindow: "1 minute" },
  refresh: { max: 60, timeWindow: "1 minute" },
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Round A — opt this scope into Zod request/response schemas. Only
  // the /refresh route is annotated so far; the other endpoints keep
  // their existing hand-rolled validation.
  const r = app.withTypeProvider<ZodTypeProvider>();

  app.post("/start", { config: { rateLimit: AUTH_LIMITS.start } }, async (req, reply) => {
    const body = startSchema.parse(req.body);
    if (!(await enforceCountryGate(app, req, reply))) return;

    // Operational kill switch: signups paused. New AND returning users
    // get a 503 so iOS surfaces a banner. (Returning users could be
    // exempted, but keeping the rule simple makes the operator's mental
    // model easier.)
    if (await app.flags.evaluate("signups_paused")) {
      return sendHttpError(reply, httpError(ErrorCodes.SIGNUPS_PAUSED));
    }

    // Metro gate: only enforced on the write paths. If iOS sent
    // declaredLocation, ensure it falls inside an active metro for the
    // inferred country.
    if (body.declaredLocation) {
      const metro = await app.checkMetro(req, { location: body.declaredLocation });
      if (!metro.allow) {
        return sendHttpError(
          reply,
          httpError(ErrorCodes.OUTSIDE_METRO, {
            message:
              "OpenMatch is opening one metro at a time. Join the waitlist to be notified when we expand.",
            details: { nearestKm: metro.nearestKm },
          }),
        );
      }
    }

    const inviteRequired = await app.flags.evaluate("invite_required");

    if (body.method === "email") {
      if (!body.email) return sendHttpError(reply, httpError(ErrorCodes.EMAIL_REQUIRED));
      // Email magic-link flow: validation of the invite happens at
      // /verify time (when the User is actually created). We do an
      // early-reject here purely as a UX courtesy so testers don't get
      // an email for a doomed flow.
      if (inviteRequired && body.inviteCode) {
        const normalized = body.inviteCode.trim().toUpperCase();
        const row = await app.prisma.betaInviteCode.findUnique({ where: { code: normalized } });
        if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) {
          return sendHttpError(reply, httpError(ErrorCodes.INVITE_INVALID));
        }
        if (row.usedCount >= row.maxUses) {
          return sendHttpError(reply, httpError(ErrorCodes.INVITE_EXHAUSTED));
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
        return sendHttpError(reply, httpError(ErrorCodes.APPLE_IDENTITY_TOKEN_REQUIRED));
      }
      try {
        const identity = await verifyAppleIdentityToken(body.appleIdentityToken, {
          rawNonce: body.appleNonce ?? null,
        });
        const { user, isNewUser } = await upsertAppleUser(app.prisma, identity, {
          inviteRequired,
          inviteCode: body.inviteCode ?? null,
        });
        const session = await issueSession(app.prisma, user.id, (p) => app.jwt.sign(p));
        return reply.send({ ...session, userId: user.id, isNewUser });
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 501) {
          return sendHttpError(
            reply,
            httpError(ErrorCodes.APPLE_NOT_CONFIGURED, {
              message:
                "Configure APPLE_TEAM_ID, APPLE_CLIENT_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY to enable Sign in with Apple.",
            }),
          );
        }
        if (e.statusCode === 400 || e.statusCode === 401 || e.statusCode === 409) {
          // Service-thrown errors carry their canonical code as `message`.
          // Preserve them verbatim so iOS can branch on e.g. invite_invalid
          // vs apple_nonce_mismatch vs apple_email_unverified without a
          // parallel mapping.
          return reply.code(e.statusCode).send({ error: e.message ?? ErrorCodes.INVITE_INVALID });
        }
        return sendHttpError(
          reply,
          httpError(ErrorCodes.APPLE_VERIFICATION_FAILED, {
            message: err instanceof Error ? err.message : "invalid_identity_token",
          }),
        );
      }
    }

    if (body.method === "dev") {
      if (!env.ALLOW_DEV_LOGIN) {
        return sendHttpError(reply, httpError(ErrorCodes.DEV_LOGIN_DISABLED));
      }
      if (!body.devUserId) {
        return sendHttpError(reply, httpError(ErrorCodes.DEV_USER_ID_REQUIRED));
      }
      const user = await app.prisma.user.findUnique({
        where: { id: body.devUserId },
      });
      if (!user) return sendHttpError(reply, httpError(ErrorCodes.USER_NOT_FOUND));
      // Dev login resolves to an existing user (returning sign-in), so
      // the new-user invite gate normally wouldn't apply. We still
      // honour an explicit `DEV_LOGIN_BYPASSES_INVITE=false` for tests
      // that want to exercise the gated path end-to-end.
      if (inviteRequired && !env.DEV_LOGIN_BYPASSES_INVITE && !body.inviteCode) {
        return sendHttpError(reply, httpError(ErrorCodes.INVITE_CODE_REQUIRED));
      }
      const session = await issueSession(
        app.prisma,
        user.id,
        (p) => app.jwt.sign(p),
        requestContext(req),
      );
      return reply.send({ ...session, userId: user.id, isNewUser: false });
    }

    return sendHttpError(reply, httpError(ErrorCodes.UNKNOWN_METHOD));
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
        return reply.code(e.statusCode).send({ error: e.message ?? ErrorCodes.INVALID_REQUEST });
      }
      throw err;
    }
  });

  // Also accept GET so the magic-link in email works in a browser.
  app.get("/verify", { config: { rateLimit: AUTH_LIMITS.verify } }, async (req, reply) => {
    // SEV-V14 — defence-in-depth Referrer-Policy on this specific
    // route. helmet already sets a global `no-referrer` policy
    // (server.ts), but this endpoint receives the magic-link token as
    // a GET query parameter; locking the header at the route level
    // means a future global change can't accidentally widen the
    // policy and leak the token via Referer on the landing page.
    reply.header("Referrer-Policy", "no-referrer");
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
        return reply.code(e.statusCode).send({ error: e.message ?? ErrorCodes.INVALID_REQUEST });
      }
      throw err;
    }
  });

  r.post(
    "/refresh",
    {
      config: { rateLimit: AUTH_LIMITS.refresh },
      schema: {
        body: refreshSchema,
        response: { 200: sessionTokensSchema },
      },
    },
    async (req, reply) => {
      const next = await rotateRefreshToken(
        app.prisma,
        req.body.refreshToken,
        (p) => app.jwt.sign(p),
        {
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
        },
      );
      if (!next) return sendHttpError(reply, httpError(ErrorCodes.INVALID_REFRESH_TOKEN));
      return reply.send(next);
    },
  );

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
      if (!result.revoked) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
      return reply.code(204).send();
    },
  );

  // SEV-A9 — the previous implementation revoked the caller's own
  // session along with every other session, locking the device out of
  // the API on the next request. The body now accepts an optional
  // `keepSessionId`; iOS surfaces this as "revoke other sessions" by
  // passing the current session id from `GET /auth/sessions`.
  const revokeAllSchema = z
    .object({ keepSessionId: z.string().min(1).max(100).optional() })
    .optional();
  app.post("/sessions/revoke-all", { preHandler: app.authenticate }, async (req, reply) => {
    const body = revokeAllSchema.parse(req.body ?? {});
    const result = await revokeAllUserSessions(app.prisma, req.userId!, {
      keepSessionId: body?.keepSessionId,
    });
    app.log.info(
      {
        event: "auth.revoke_all_sessions",
        userId: req.userId,
        count: result.revokedCount,
        keptCurrent: Boolean(body?.keepSessionId),
      },
      "all_sessions_revoked",
    );
    return reply.send(result);
  });
};
