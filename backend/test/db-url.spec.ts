import { describe, expect, it } from "vitest";
import { ensureConnectionLimit } from "../src/lib/db-url.js";

// PERF-1 — connection_limit append helper.

describe("ensureConnectionLimit", () => {
  it("appends connection_limit=20 when no query string is present", () => {
    const out = ensureConnectionLimit("postgresql://u:p@h:5432/db");
    expect(out).toMatch(/[?&]connection_limit=20\b/);
  });

  it("appends connection_limit on a URL that already has params", () => {
    const out = ensureConnectionLimit("postgresql://u:p@h:5432/db?sslmode=require");
    expect(out).toMatch(/[?&]connection_limit=20\b/);
    expect(out).toMatch(/sslmode=require/);
  });

  it("respects an existing connection_limit", () => {
    const out = ensureConnectionLimit(
      "postgresql://u:p@h:5432/db?sslmode=require&connection_limit=5",
    );
    expect(out).toMatch(/connection_limit=5\b/);
    expect(out).not.toMatch(/connection_limit=20\b/);
  });

  it("honours an explicit override", () => {
    const out = ensureConnectionLimit("postgresql://u:p@h:5432/db", 42);
    expect(out).toMatch(/connection_limit=42\b/);
  });

  it("returns the input unchanged when given an empty string", () => {
    expect(ensureConnectionLimit("")).toBe("");
  });
});
