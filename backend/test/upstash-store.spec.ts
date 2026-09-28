import rateLimit from "@fastify/rate-limit";
import type { Redis } from "@upstash/redis";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { UpstashStore } from "../src/plugins/ratelimit.js";

describe("Upstash rate-limit store contract", () => {
  it("separates route keys and passes runtime windows and options to Redis", async () => {
    const evalMock = vi.fn().mockResolvedValue([2, 1234]);
    const redis = { eval: evalMock } as unknown as Redis;
    const parent = new UpstashStore(redis, { timeWindow: 60_000 });
    const a = parent.child({ routeInfo: { method: "POST", url: "/a" } });
    const b = parent.child({ routeInfo: { method: "POST", url: "/b" } });
    const increment = (store: UpstashStore) =>
      new Promise((resolve, reject) => {
        store.incr(
          "caller",
          (error, result) => (error ? reject(error) : resolve(result)),
          5000,
          10,
        );
      });
    expect(await increment(a)).toEqual({ current: 2, ttl: 1234 });
    await increment(b);
    expect(evalMock.mock.calls[0]![1]).not.toEqual(evalMock.mock.calls[1]![1]);
    expect(evalMock.mock.calls[0]![2]).toEqual([5000, 10, "false", "false"]);
  });

  it("propagates storage failures instead of admitting requests", async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error("redis down")) } as unknown as Redis;
    const store = new UpstashStore(redis, { timeWindow: 1000 });
    await expect(
      new Promise((resolve, reject) =>
        store.incr("ip", (err, result) => (err ? reject(err) : resolve(result))),
      ),
    ).rejects.toThrow("redis down");
  });

  it("isolates two route limits through Fastify's custom store interface", async () => {
    const counts = new Map<string, number>();
    const redis = {
      eval: vi.fn(async (_script, keys: string[]) => {
        const count = (counts.get(keys[0]!) ?? 0) + 1;
        counts.set(keys[0]!, count);
        return [count, 1000];
      }),
    } as unknown as Redis;
    const app = Fastify();
    await app.register(rateLimit, {
      global: false,
      store: UpstashStore.bind(null, redis) as never,
    });
    for (const url of ["/a", "/b"])
      app.get(url, { config: { rateLimit: { max: 1, timeWindow: 1000 } } }, async () => ({
        ok: true,
      }));
    try {
      expect((await app.inject("/a")).statusCode).toBe(200);
      expect((await app.inject("/a")).statusCode).toBe(429);
      expect((await app.inject("/b")).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
