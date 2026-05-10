import { Redis } from "ioredis";
import fp from "fastify-plugin";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async (app) => {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
  redis.on("error", (err: Error) => app.log.warn({ err }, "redis error"));
  app.decorate("redis", redis);
  app.addHook("onClose", async () => {
    await redis.quit().catch(() => undefined);
  });
});
