import { describe, expect, it } from "vitest";
import { resolveSmtpTlsOptions } from "../src/lib/smtp.js";

// SEV-N1 — SMTP transport TLS option resolver.

describe("resolveSmtpTlsOptions", () => {
  it("enforces certificate verification in production", () => {
    expect(resolveSmtpTlsOptions("production")).toEqual({ rejectUnauthorized: true });
  });

  it("accepts self-signed certs in development (MailHog)", () => {
    expect(resolveSmtpTlsOptions("development")).toEqual({ rejectUnauthorized: false });
  });

  it("accepts self-signed certs in test", () => {
    expect(resolveSmtpTlsOptions("test")).toEqual({ rejectUnauthorized: false });
  });

  it("treats unknown env values the same as non-production (fail-open for the dev loop)", () => {
    expect(resolveSmtpTlsOptions("staging")).toEqual({ rejectUnauthorized: false });
    expect(resolveSmtpTlsOptions("")).toEqual({ rejectUnauthorized: false });
  });
});
