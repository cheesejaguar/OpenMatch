import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

// Distinct admin JWT namespace from the consumer one declared in
// plugins/auth.ts. We register a second @fastify/jwt instance with a
// dedicated namespace so the two cannot accidentally accept each other's
// tokens.

export interface AdminClaims {
  sub: string; // adminUserId
  sid?: string; // adminSessionId (omitted for legacy tokens / tests that mint via signAdminAccessToken)
  scope: "admin";
  iat: number;
  exp: number;
}

export interface AdminPrincipal {
  adminUserId: string;
  email: string;
  roleNames: string[];
  permissions: string[];
  sessionId: string | null;
  twoFactorAt: Date | null;
  twoFactorRequired: boolean;
  totpEnrolledAt: Date | null;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticateAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminTwoFactor: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signAdminAccessToken: (adminUserId: string, sessionId?: string) => string;
  }
  interface FastifyRequest {
    admin?: AdminPrincipal;
  }
}

export default fp(async (app) => {
  await app.register(fastifyJwt, {
    namespace: "admin",
    jwtVerify: "adminJwtVerify",
    jwtSign: "adminJwtSign",
    secret: env.ADMIN_JWT_SECRET,
    sign: {
      expiresIn: `${env.ADMIN_ACCESS_TTL_SECONDS}s`,
    },
  });

  app.decorate("signAdminAccessToken", (adminUserId: string, sessionId?: string) => {
    // @ts-expect-error - augmented by fastify-jwt namespace
    return app.jwt.admin.sign({ sub: adminUserId, sid: sessionId, scope: "admin" });
  });

  app.decorate("authenticateAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // @ts-expect-error - augmented by fastify-jwt namespace
      const payload = (await req.adminJwtVerify()) as AdminClaims;
      if (payload.scope !== "admin") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const admin = await app.prisma.adminUser.findUnique({
        where: { id: payload.sub },
        include: { roles: { include: { adminRole: true } } },
      });
      if (!admin || admin.status !== "active") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      // Look up the bearer-token's session row so downstream 2FA gating
      // can read `twoFactorAt`. `sid` is optional in the claim set —
      // legacy tokens minted before R3 / unit-test helpers that call
      // `signAdminAccessToken(adminUserId)` without a session id will
      // have `null` here. Those callers cannot satisfy a 2FA gate but
      // remain valid for the auth subtree (/me, /totp/enroll, etc.).
      let sessionId: string | null = null;
      let twoFactorAt: Date | null = null;
      if (payload.sid) {
        const session = await app.prisma.adminSession.findUnique({
          where: { id: payload.sid },
        });
        if (session && !session.revokedAt && session.expiresAt.getTime() > Date.now()) {
          sessionId = session.id;
          twoFactorAt = session.twoFactorAt ?? null;
        }
      }
      const roleNames = admin.roles.map((r) => r.adminRole.name);
      const permissions = Array.from(new Set(admin.roles.flatMap((r) => r.adminRole.permissions)));
      req.admin = {
        adminUserId: admin.id,
        email: admin.email,
        roleNames,
        permissions,
        sessionId,
        twoFactorAt,
        twoFactorRequired: admin.twoFactorRequired,
        totpEnrolledAt: admin.totpEnrolledAt ?? null,
      };
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  // Hook used by every admin route except the auth subtree to enforce
  // session-level 2FA elevation. Returns 403 with one of:
  //   - `totp_enrollment_required`  (admin has no secret on file)
  //   - `two_factor_required`        (secret exists; session is not elevated)
  // The env switch `ADMIN_2FA_OPTIONAL=true` short-circuits this and is
  // documented as dev-only.
  app.decorate("requireAdminTwoFactor", async (req: FastifyRequest, reply: FastifyReply) => {
    const p = req.admin;
    if (!p) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    // Test environment short-circuits so existing helper-minted tokens
    // (signAdminAccessToken with no sessionId) keep working. The 2FA
    // suite explicitly opts back into enforcement by setting
    // `ADMIN_2FA_TEST_ENFORCE=true`. Production and dev paths always
    // run the full gate.
    if (env.ADMIN_2FA_OPTIONAL) return;
    if (env.NODE_ENV === "test" && process.env.ADMIN_2FA_TEST_ENFORCE !== "true") return;
    if (!p.twoFactorRequired) return;
    if (!p.totpEnrolledAt) {
      return reply.code(403).send({ error: "totp_enrollment_required" });
    }
    if (!p.twoFactorAt) {
      return reply.code(403).send({ error: "two_factor_required" });
    }
  });
});
