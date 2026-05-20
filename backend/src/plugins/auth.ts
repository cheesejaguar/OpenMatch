import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

// SEV-V3 / SEV-A13: pin issuer + audience so a consumer JWT can never
// be confused with an admin JWT even if the two HS256 secrets are ever
// accidentally aligned. Pinning algorithm closes the `alg:none` /
// key-confusion class of bugs the moment any future caller introduces
// an asymmetric key.
export const CONSUMER_JWT_ISSUER = "openmatch-api";
export const CONSUMER_JWT_AUDIENCE = "openmatch-ios";

export interface AuthClaims {
  sub: string; // user id
  scope: "user";
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: string;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; scope: "user" };
    user: AuthClaims;
  }
}

export default fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      algorithm: "HS256",
      expiresIn: `${env.JWT_ACCESS_TTL_SECONDS}s`,
      iss: CONSUMER_JWT_ISSUER,
      aud: CONSUMER_JWT_AUDIENCE,
    },
    verify: {
      algorithms: ["HS256"],
      allowedIss: CONSUMER_JWT_ISSUER,
      allowedAud: CONSUMER_JWT_AUDIENCE,
    },
  });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const claims = req.user as AuthClaims;
      // Defence-in-depth: the verify-time `allowedIss`/`allowedAud`
      // checks reject mismatched values, but a future refactor that
      // weakens those options would silently regress this. Re-check
      // here so the failure is the same shape.
      if (claims.iss !== CONSUMER_JWT_ISSUER || claims.aud !== CONSUMER_JWT_AUDIENCE) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      // SEV-A6 — refuse any token whose underlying user is paused,
      // banned, or deleted. A scheduled-deletion user (status =
      // paused) keeps a valid-signature JWT until exp; without this
      // check the still-in-flight token would let the attacker
      // continue to read /me, message established matches, and most
      // critically cancel the pending deletion. The lookup is cheap
      // (PK index on User.id) and would benefit from a Redis-cached
      // status column in a follow-up if it ever shows up in flame
      // graphs.
      const user = await req.server.prisma.user
        .findUnique({
          where: { id: claims.sub },
          select: { status: true },
        })
        .catch(() => null);
      if (!user) return reply.code(401).send({ error: "unauthorized" });
      if (user.status !== "active") {
        return reply.code(401).send({ error: "account_inactive" });
      }
      req.userId = claims.sub;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
});
