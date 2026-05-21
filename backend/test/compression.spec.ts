import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

// PERF — @fastify/compress wiring smoke test.
//
// Confirms two boundary conditions:
//   1. A response over the 1KB threshold negotiates Brotli when the
//      client advertises `accept-encoding: br`.
//   2. A response under the threshold skips compression — we don't want
//      the CPU/latency hit on tiny payloads (e.g. `{ ok: true }`).
//
// We use `app.inject` so the test stays in-process; Fastify still runs
// the compress onSend hook in inject mode.

let app: Awaited<ReturnType<typeof buildServer>> | null = null;

describe("Response compression", () => {
  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("compresses /openapi.json with brotli when client supports it", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/openapi.json",
      headers: { "accept-encoding": "br" },
    });
    expect(res.statusCode).toBe(200);
    // @fastify/compress strips Accept-Encoding match and sets
    // Content-Encoding on the wire. Header lookup is case-insensitive.
    expect(res.headers["content-encoding"]).toBe("br");
    // The compressed payload should be smaller than the equivalent
    // uncompressed JSON spec (typically hundreds of KB → tens of KB).
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("falls back to gzip when brotli isn't offered", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/openapi.json",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("skips compression for responses below the 1KB threshold", async () => {
    // /health returns `{ ok: true }` — well under 1KB.
    const res = await app!.inject({
      method: "GET",
      url: "/health",
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("sets cache-control on /openapi.json", async () => {
    const res = await app!.inject({
      method: "GET",
      url: "/openapi.json",
    });
    expect(res.statusCode).toBe(200);
    const cc = res.headers["cache-control"];
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/max-age=300/);
    expect(cc).toMatch(/stale-while-revalidate=600/);
  });
});
