import rateLimit from "@fastify/rate-limit";
import type { Redis } from "@upstash/redis";
import fp from "fastify-plugin";
import { redis } from "./redis.js";

// Custom store backed by Upstash Redis. Without a shared store every Vercel
// function invocation starts with a fresh in-memory counter, which makes
// rate limiting effectively a no-op. See plan for rationale.
//
// These limits exist to protect users from spam/abuse. They are NEVER
// bypassable by payment. See docs/product/openmatch-design.md §15.4.

interface StoreOptions {
  timeWindow: number;
  continueExceeding?: boolean;
  nameSpace?: string;
}

type StoreCallback = (err: Error | null, result?: { current: number; ttl: number }) => void;

class UpstashStore {
  private redis: Redis;
  private options: StoreOptions;

  constructor(client: Redis, options: StoreOptions) {
    this.redis = client;
    this.options = options;
  }

  child(routeOptions: Partial<StoreOptions>): UpstashStore {
    return new UpstashStore(this.redis, { ...this.options, ...routeOptions });
  }

  incr(ip: string, cb: StoreCallback): void {
    const ns = this.options.nameSpace ?? "om:rl:";
    const key = `${ns}${ip}`;
    const tw = this.options.timeWindow;
    this.redis
      .multi()
      .incr(key)
      .pexpire(key, tw)
      .pttl(key)
      .exec<[number, number, number]>()
      .then(([current, , ttl]) => {
        cb(null, { current, ttl: ttl > 0 ? ttl : tw });
      })
      .catch((err: Error) => cb(err));
  }
}

export default fp(async (app) => {
  const opts: Parameters<typeof rateLimit>[1] = {
    global: false,
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req as { userId?: string }).userId ?? req.ip ?? "anon",
    errorResponseBuilder: (_req, ctx) => ({
      error: "rate_limited",
      message:
        "You're moving fast. This limit exists to protect users from spam — it is never bypassable by payment.",
      retryAfter: ctx.after,
    }),
  };

  if (redis) {
    opts.store = UpstashStore.bind(null, redis) as never;
  }

  await app.register(rateLimit, opts);
});
