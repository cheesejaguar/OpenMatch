import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { healthRoutes } from "../src/routes/health.js";

async function build(query: () => Promise<unknown>) {
  const app = Fastify();
  app.decorate("prisma", { $queryRawUnsafe: query });
  app.decorate("redis", null);
  await app.register(healthRoutes);
  return app;
}

describe("readiness cache isolation", () => {
  it("shares in-flight probes and does not reuse one app's health for another", async () => {
    const query = vi.fn(async () => [1]);
    const healthy = await build(query);
    const unhealthy = await build(async () => {
      throw new Error("postgresql://user:secret@private-host");
    });
    try {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => healthy.inject("/ready")),
      );
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
      const failed = await unhealthy.inject("/ready");
      expect(failed.statusCode).toBe(503);
      expect(failed.body).not.toContain("secret");
      expect(failed.body).not.toContain("private-host");
    } finally {
      await healthy.close();
      await unhealthy.close();
    }
  });
});
