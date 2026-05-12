import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";
import ws from "ws";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

// Neon's serverless driver speaks WebSockets when running in Node (vs. native
// `fetch` in Edge). Wire the ws shim once per process.
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

type GlobalWithPrisma = typeof globalThis & { __omPrisma?: PrismaClient };
const g = globalThis as GlobalWithPrisma;

function buildClient(): PrismaClient {
  // In test/dev against a vanilla Postgres (the docker-compose service or
  // the CI container), the Neon WebSocket adapter doesn't speak the same
  // protocol and connections hang. Use adapter-pg in those environments —
  // production still uses Neon.
  const useNeonAdapter = env.NODE_ENV === "production" || /\.neon\.tech\b/.test(env.DATABASE_URL);
  const adapter = useNeonAdapter
    ? new PrismaNeon({ connectionString: env.DATABASE_URL })
    : new PrismaPg(env.DATABASE_URL);
  return new PrismaClient({ adapter });
}

if (!g.__omPrisma) {
  g.__omPrisma = buildClient();
}
export const prisma: PrismaClient = g.__omPrisma;

export default fp(async (app) => {
  app.decorate("prisma", prisma);
});
