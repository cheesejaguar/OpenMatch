import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
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
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter });
}

if (!g.__omPrisma) {
  g.__omPrisma = buildClient();
}
export const prisma: PrismaClient = g.__omPrisma;

export default fp(async (app) => {
  app.decorate("prisma", prisma);
});
