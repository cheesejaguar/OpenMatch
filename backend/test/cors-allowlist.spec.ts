import { describe, expect, it } from "vitest";
import { CorsConfigError, parseCorsAllowlist } from "../src/lib/cors-allowlist.js";

// SEV-N4 — strict CORS allow-list parsing.

describe("parseCorsAllowlist", () => {
  it("returns origins normalised to scheme+host+port for valid entries", () => {
    const out = parseCorsAllowlist(
      "https://app.openmatch.com,https://www.openmatch.com",
      "https://admin.openmatch.com",
      "production",
    );
    expect(out).toEqual([
      "https://app.openmatch.com",
      "https://www.openmatch.com",
      "https://admin.openmatch.com",
    ]);
  });

  it("dedupes entries that appear in both consumer and admin lists", () => {
    const out = parseCorsAllowlist(
      "https://app.openmatch.com",
      "https://app.openmatch.com,https://admin.openmatch.com",
      "production",
    );
    expect(out).toEqual(["https://app.openmatch.com", "https://admin.openmatch.com"]);
  });

  it("trims whitespace around entries", () => {
    const out = parseCorsAllowlist(
      "  https://app.openmatch.com  ,  https://www.openmatch.com  ",
      "",
      "production",
    );
    expect(out).toEqual(["https://app.openmatch.com", "https://www.openmatch.com"]);
  });

  it("strips a trailing slash on the entry (URL.origin)", () => {
    // `new URL("https://app.openmatch.com/")` yields pathname "/" which
    // is permitted; the origin form drops it.
    const out = parseCorsAllowlist("https://app.openmatch.com/", "", "production");
    expect(out).toEqual(["https://app.openmatch.com"]);
  });

  it("rejects entries with a non-root path", () => {
    expect(() =>
      parseCorsAllowlist("https://app.openmatch.com/some-path", "", "production"),
    ).toThrow(CorsConfigError);
  });

  it("rejects '*' literal entries", () => {
    expect(() => parseCorsAllowlist("*", "", "production")).toThrow(CorsConfigError);
  });

  it("rejects 'null' literal entries", () => {
    expect(() => parseCorsAllowlist("null", "", "production")).toThrow(CorsConfigError);
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => parseCorsAllowlist("javascript:alert(1)", "", "production")).toThrow(
      CorsConfigError,
    );
  });

  it("rejects malformed URLs", () => {
    expect(() => parseCorsAllowlist("not a url", "", "production")).toThrow(CorsConfigError);
  });

  it("rejects entries with a query string or fragment", () => {
    expect(() => parseCorsAllowlist("https://app.openmatch.com?x=1", "", "production")).toThrow(
      CorsConfigError,
    );
    expect(() => parseCorsAllowlist("https://app.openmatch.com#frag", "", "production")).toThrow(
      CorsConfigError,
    );
  });

  it("rejects userinfo in the URL", () => {
    expect(() =>
      parseCorsAllowlist("https://user:pass@app.openmatch.com", "", "production"),
    ).toThrow(CorsConfigError);
  });

  it("rejects an empty allowlist in production", () => {
    expect(() => parseCorsAllowlist("", "", "production")).toThrow(CorsConfigError);
  });

  it("permits an empty allowlist in development", () => {
    expect(parseCorsAllowlist("", "", "development")).toEqual([]);
  });

  it("permits localhost entries in development", () => {
    const out = parseCorsAllowlist("http://localhost:5173", "http://localhost:3000", "development");
    expect(out).toEqual(["http://localhost:5173", "http://localhost:3000"]);
  });

  it("rejects localhost entries in production", () => {
    expect(() =>
      parseCorsAllowlist("http://localhost:5173", "https://admin.openmatch.com", "production"),
    ).toThrow(CorsConfigError);
  });

  it("rejects 127.0.0.1 entries in production", () => {
    expect(() => parseCorsAllowlist("http://127.0.0.1:8080", "", "production")).toThrow(
      CorsConfigError,
    );
  });

  it("rejects IPv6 loopback in production", () => {
    expect(() => parseCorsAllowlist("http://[::1]:8080", "", "production")).toThrow(
      CorsConfigError,
    );
  });
});
