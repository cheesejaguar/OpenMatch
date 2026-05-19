import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

// Round C — Smoke test for the public OpenAPI document.
//
// Boots a real Fastify instance with every plugin + route registered,
// then asks the swagger plugin for the spec via GET /openapi.json. We
// don't assert on the full document — just the load-bearing top-level
// shape and the presence of at least a baseline number of paths, so a
// future plumbing regression that drops all routes from the spec
// surfaces in CI.

let app: Awaited<ReturnType<typeof buildServer>> | null = null;

describe("OpenAPI document", () => {
  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("GET /openapi.json returns OpenAPI 3.1 with our metadata", async () => {
    const res = await app!.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toMatch(/^3\.1/);
    expect(body.info.title).toBe("OpenMatch API");
    expect(body.info.version).toBe("0.1.0");
    expect(Object.keys(body.paths).length).toBeGreaterThanOrEqual(10);
  });

  it("excludes internal worker endpoints from the public spec", async () => {
    const res = await app!.inject({ method: "GET", url: "/openapi.json" });
    const body = res.json() as { paths: Record<string, unknown> };
    for (const path of Object.keys(body.paths)) {
      expect(path.startsWith("/api/v1/internal/")).toBe(false);
    }
  });

  it("excludes admin RBAC endpoints from the public spec", async () => {
    const res = await app!.inject({ method: "GET", url: "/openapi.json" });
    const body = res.json() as { paths: Record<string, unknown> };
    for (const path of Object.keys(body.paths)) {
      expect(path.startsWith("/api/v1/admin/")).toBe(false);
    }
  });

  it("declares bearerAuth in components.securitySchemes", async () => {
    const res = await app!.inject({ method: "GET", url: "/openapi.json" });
    const body = res.json() as {
      components?: { securitySchemes?: Record<string, { type: string; scheme?: string }> };
    };
    expect(body.components?.securitySchemes?.bearerAuth?.type).toBe("http");
    expect(body.components?.securitySchemes?.bearerAuth?.scheme).toBe("bearer");
  });

  it("serves a Swagger UI at /api-docs/", async () => {
    const res = await app!.inject({ method: "GET", url: "/api-docs/static/index.html" });
    // Swagger UI's static handler may return 200 with HTML or 302 to
    // the index — either way, an HTTP 4xx/5xx means the plugin failed
    // to register.
    expect(res.statusCode).toBeLessThan(400);
  });
});
