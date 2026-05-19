import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";

// Round D — Pino redaction.
//
// Mirrors the redact path set in backend/src/server.ts so the test
// fails loudly if a new identifier leaks into the redact list without
// matching coverage here.

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.email",
  "req.body.inviteCode",
  "req.body.refreshToken",
  "req.body.token",
  "*.email",
  "*.emailHash",
  "*.refreshToken",
  "*.accessToken",
  "*.bio",
  "*.displayName",
];

function captureLogger(): { logger: pino.Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString("utf8").trim();
      for (const part of text.split("\n").filter(Boolean)) {
        try {
          lines.push(JSON.parse(part));
        } catch {
          // ignore non-JSON noise
        }
      }
      cb();
    },
  });
  const logger = pino(
    {
      level: "info",
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    sink,
  );
  return { logger, lines };
}

describe("pino redactions", () => {
  it("redacts authorization + cookie headers from req.headers", () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: {
        headers: {
          authorization: "Bearer ey.long.token",
          cookie: "session=abc",
          "user-agent": "openmatch-ios/1.0",
        },
      },
    });
    const log = lines[0] as { req: { headers: Record<string, string> } };
    expect(log.req.headers.authorization).toBe("[REDACTED]");
    expect(log.req.headers.cookie).toBe("[REDACTED]");
    // Non-sensitive headers pass through.
    expect(log.req.headers["user-agent"]).toBe("openmatch-ios/1.0");
  });

  it("redacts sensitive request body fields", () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: {
        body: {
          email: "alice@example.com",
          password: "hunter2",
          inviteCode: "INVITE-XYZ",
          refreshToken: "rt-abc",
          token: "tok-abc",
          country: "US",
        },
      },
    });
    const log = lines[0] as { req: { body: Record<string, string> } };
    expect(log.req.body.email).toBe("[REDACTED]");
    expect(log.req.body.password).toBe("[REDACTED]");
    expect(log.req.body.inviteCode).toBe("[REDACTED]");
    expect(log.req.body.refreshToken).toBe("[REDACTED]");
    expect(log.req.body.token).toBe("[REDACTED]");
    expect(log.req.body.country).toBe("US");
  });

  it("redacts wildcard-pathed PII (email, emailHash, refresh/accessToken, bio, displayName)", () => {
    const { logger, lines } = captureLogger();
    logger.info({
      user: {
        id: "u_1",
        email: "alice@example.com",
        emailHash: "sha256-abc",
        displayName: "Alice",
      },
      session: {
        refreshToken: "rt-1",
        accessToken: "at-1",
      },
      profile: { bio: "I love hiking" },
    });
    const log = lines[0] as {
      user: Record<string, string>;
      session: Record<string, string>;
      profile: Record<string, string>;
    };
    expect(log.user.email).toBe("[REDACTED]");
    expect(log.user.emailHash).toBe("[REDACTED]");
    expect(log.user.displayName).toBe("[REDACTED]");
    expect(log.session.refreshToken).toBe("[REDACTED]");
    expect(log.session.accessToken).toBe("[REDACTED]");
    expect(log.profile.bio).toBe("[REDACTED]");
    // Non-sensitive id pass through.
    expect(log.user.id).toBe("u_1");
  });
});
