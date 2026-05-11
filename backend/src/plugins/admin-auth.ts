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
  scope: "admin";
  iat: number;
  exp: number;
}

export interface AdminPrincipal {
  adminUserId: string;
  email: string;
  roleNames: string[];
  permissions: string[];
}

declare module "fastify" {
  interface FastifyInstance {
    authenticateAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    signAdminAccessToken: (adminUserId: string) => string;
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

  app.decorate("signAdminAccessToken", (adminUserId: string) => {
    // @ts-expect-error - augmented by fastify-jwt namespace
    return app.jwt.admin.sign({ sub: adminUserId, scope: "admin" });
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
      const roleNames = admin.roles.map((r) => r.adminRole.name);
      const permissions = Array.from(new Set(admin.roles.flatMap((r) => r.adminRole.permissions)));
      req.admin = {
        adminUserId: admin.id,
        email: admin.email,
        roleNames,
        permissions,
      };
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
});
