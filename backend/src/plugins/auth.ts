import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";

export interface AuthClaims {
  sub: string; // user id
  scope: "user";
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
    sign: { expiresIn: `${env.JWT_ACCESS_TTL_SECONDS}s` },
  });

  app.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
        req.userId = (req.user as AuthClaims).sub;
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    },
  );
});
