import { describe, expect, it } from "vitest";
import { initSentry, sentryFastifyErrorHook, sentryUserHook } from "../src/lib/sentry.js";

// OPS-3 — Sentry init must be a no-op when DSN is absent.

describe("sentry wiring", () => {
  it("initSentry does not throw when DSN is absent", () => {
    expect(() => initSentry()).not.toThrow();
  });

  it("hooks no-op when DSN is absent", () => {
    // Simulate a fastify request object with the minimum surface our
    // hooks read. Should not throw.
    const fakeReq = {
      userId: "u_test",
      routeOptions: { url: "/api/v1/whatever" },
      method: "GET",
      url: "/api/v1/whatever",
    } as never;
    expect(() => sentryUserHook(fakeReq)).not.toThrow();
    expect(() => sentryFastifyErrorHook(fakeReq, new Error("boom"))).not.toThrow();
  });
});
