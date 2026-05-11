import { Redis } from "@upstash/redis";
import fp from "fastify-plugin";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis | null;
  }
}

type GlobalWithRedis = typeof globalThis & { __omRedis?: Redis | null };
const g = globalThis as GlobalWithRedis;

function buildClient(): Redis | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
}

if (g.__omRedis === undefined) {
  g.__omRedis = buildClient();
}
export const redis: Redis | null = g.__omRedis;

export default fp(async (app) => {
  app.decorate("redis", redis);
});
