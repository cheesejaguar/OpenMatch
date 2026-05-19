import type * as Sentry from "@sentry/node";
import { describe, expect, it } from "vitest";
import { requestContext } from "../src/lib/request-context.js";
import { beforeSendForTest } from "../src/lib/sentry.js";

// Round D — Sentry beforeSend filter.
//
// Coverage:
//   - 4xx HttpError-shape throws are dropped (return null)
//   - rate-limit + AbortError dropped
//   - generic Error reaches Sentry and gets tagged with requestId

function evt(): Sentry.ErrorEvent {
  return { event_id: "abc", type: undefined } as Sentry.ErrorEvent;
}

describe("sentry beforeSend filter", () => {
  it("drops 4xx HttpError-shape exceptions", () => {
    const err = Object.assign(new Error("invite_invalid"), { statusCode: 400 });
    expect(beforeSendForTest(evt(), { originalException: err })).toBeNull();
  });

  it("drops rate-limit signals regardless of HTTP code", () => {
    const err = Object.assign(new Error("rate_limited"), { code: "RATE_LIMITED" });
    expect(beforeSendForTest(evt(), { originalException: err })).toBeNull();
  });

  it("drops 429 by statusCode", () => {
    const err = Object.assign(new Error("too_many"), { statusCode: 429 });
    expect(beforeSendForTest(evt(), { originalException: err })).toBeNull();
  });

  it("drops AbortError", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(beforeSendForTest(evt(), { originalException: err })).toBeNull();
  });

  it("passes a generic 5xx crash through and tags with requestId + userId", async () => {
    const real = new Error("kaboom");
    await requestContext.run({ requestId: "req-99", userId: "u_alice" }, async () => {
      const out = beforeSendForTest(evt(), { originalException: real });
      expect(out).not.toBeNull();
      expect(out?.tags?.requestId).toBe("req-99");
      expect(out?.user?.id).toBe("u_alice");
    });
  });

  it("passes generic Error through even without a context", () => {
    const real = new Error("kaboom");
    const out = beforeSendForTest(evt(), { originalException: real });
    expect(out).not.toBeNull();
  });

  it("passes a 500 HttpError-shape through", () => {
    const err = Object.assign(new Error("internal"), { statusCode: 500 });
    const out = beforeSendForTest(evt(), { originalException: err });
    expect(out).not.toBeNull();
  });
});
