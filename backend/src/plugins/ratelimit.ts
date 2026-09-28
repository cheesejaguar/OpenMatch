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
  exponentialBackoff?: boolean;
  nameSpace?: string;
  routeInfo?: { method?: string | string[]; url?: string };
}

type StoreCallback = (err: Error | null, result?: { current: number; ttl: number }) => void;

// Atomic fixed-window increment. Ordinary traffic must not extend the window.
// Match Fastify's optional continueExceeding/exponentialBackoff semantics.
export const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local window = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local ttl = redis.call('PTTL', KEYS[1])
if current == 1 or ttl < 0 or (ARGV[3] == 'true' and current > max) then
  redis.call('PEXPIRE', KEYS[1], window)
elseif ARGV[4] == 'true' and current > max then
  window = math.min(window * (2 ^ (current - max - 1)), 9007199254740991)
  redis.call('PEXPIRE', KEYS[1], window)
end
return {current, redis.call('PTTL', KEYS[1])}
`;

export class UpstashStore {
  constructor(
    private readonly redis: Redis,
    private readonly options: StoreOptions,
  ) {}

  child(routeOptions: Partial<StoreOptions>): UpstashStore {
    const route = routeOptions.routeInfo;
    return new UpstashStore(this.redis, {
      ...this.options,
      ...routeOptions,
      nameSpace: `${this.options.nameSpace ?? "om:rl:"}${JSON.stringify([route?.method ?? "", route?.url ?? ""])}:`,
    });
  }

  incr(ip: string, cb: StoreCallback, timeWindow = this.options.timeWindow, max = 600): void {
    const key = `${this.options.nameSpace ?? "om:rl:"}${ip}`;
    this.redis
      .eval<[number, number, string, string], [number, number]>(
        RATE_LIMIT_SCRIPT,
        [key],
        [
          timeWindow,
          max,
          String(Boolean(this.options.continueExceeding)),
          String(Boolean(this.options.exponentialBackoff)),
        ],
      )
      .then(([current, ttl]) => cb(null, { current, ttl: Math.max(0, ttl) }))
      .catch((err: Error) => cb(err));
  }
}

export default fp(async (app) => {
  const opts: Parameters<typeof rateLimit>[1] = {
    global: false,
    max: 600,
    timeWindow: "1 minute",
    // Runs at onRequest by default, before consumer authentication. The
    // IP is the pre-auth abuse boundary; routes needing a per-account
    // quota must add one after authentication rather than trusting a JWT
    // payload here. A composite user/IP key is not an independent IP cap.
    keyGenerator: (req) => {
      const userId = (req as { userId?: string }).userId;
      const ip = req.ip;
      return `${userId ?? "anon"}:${ip ?? "noip"}`;
    },
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
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
