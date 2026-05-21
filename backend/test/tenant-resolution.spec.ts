import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import tenantPlugin, {
  resetTenantResolver,
  setTenantResolver,
  type TenantContext,
} from "../src/lib/tenant.js";

// Tenant-resolution decoration. The plugin runs onRequest and exposes
// `req.tenant` on every handler. Default deploys see `tenantId: 'default'`;
// the x-openmatch-tenant header and subdomain fallback are also
// covered here so forks know which hooks they can rely on.

async function buildApp() {
  const app = Fastify();
  await app.register(tenantPlugin);
  app.get("/echo", async (req) => {
    return req.tenant;
  });
  return app;
}

afterEach(() => {
  resetTenantResolver();
});

describe("tenant resolution", () => {
  it("falls back to 'default' for a vanilla request", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/echo" });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenantId).toBe("default");
    await app.close();
  });

  it("honours the x-openmatch-tenant header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/echo",
      headers: { "x-openmatch-tenant": "acme" },
    });
    expect(res.json().tenantId).toBe("acme");
    await app.close();
  });

  it("infers the tenant from the host subdomain", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/echo",
      headers: { host: "acme.openmatch.app" },
    });
    expect(res.json().tenantId).toBe("acme");
    await app.close();
  });

  it("ignores reserved subdomains (www, api, admin, app)", async () => {
    const app = await buildApp();
    for (const host of [
      "www.openmatch.app",
      "api.openmatch.app",
      "admin.openmatch.app",
      "app.openmatch.app",
    ]) {
      const res = await app.inject({ method: "GET", url: "/echo", headers: { host } });
      expect(res.json().tenantId).toBe("default");
    }
    await app.close();
  });

  it("rejects an unsafe header value (no SQL/path injection vectors)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/echo",
      headers: { "x-openmatch-tenant": "../etc/passwd" },
    });
    // Unsafe value is silently dropped; default fallback applies.
    expect(res.json().tenantId).toBe("default");
    await app.close();
  });

  it("supports a custom resolver registered via setTenantResolver", async () => {
    setTenantResolver((req) => {
      const raw = req.headers["x-fork-tenant"];
      const tenantId = typeof raw === "string" ? raw : "fallback";
      const ctx: TenantContext = {
        tenantId,
        // Forks would resolve a per-tenant OpenMatchConfig here.
        // Reuse the default shape so the spec stays type-safe.
        config: {
          variant: "custom",
          features: {
            requireGenderPreferences: false,
            requireAgeWindow: false,
            requirePhotos: false,
            minPhotos: 0,
            maxPhotos: 9,
            enableMatchOverlay: false,
            enableSwipeDeck: true,
            enableBoosts: false,
            enableVerification: false,
            enableVoiceNotes: false,
            enableVideoNotes: false,
          },
          copy: {
            appName: "ForkApp",
            matchVerb: "matched",
            swipeRightVerb: "like",
            profilePrompt: "Hi",
          },
          branding: {
            primaryColorLight: "#000000",
            primaryColorDark: "#FFFFFF",
            accentColorLight: "#000000",
            accentColorDark: "#FFFFFF",
          },
        },
      };
      return ctx;
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/echo",
      headers: { "x-fork-tenant": "tenant-xyz" },
    });
    expect(res.json().tenantId).toBe("tenant-xyz");
    await app.close();
  });
});
