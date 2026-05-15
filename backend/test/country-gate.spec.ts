import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import countryGatePlugin from "../src/plugins/country-gate.js";

// Tests for the country-gate plugin's decoration logic — the
// stricter-of-(inferred, declared) wins rule. The plugin doesn't
// depend on prisma, so we can build a minimal Fastify app for the
// unit-level check without spinning up the DB.

async function build() {
  const app = Fastify({ logger: false });
  await app.register(countryGatePlugin);
  return app;
}

describe("country-gate plugin", () => {
  it("inferCountry pulls from Vercel header first, then Cloudflare, then test header", async () => {
    const app = await build();
    try {
      let captured: string | null = null;
      app.get("/probe", async (req) => {
        captured = app.inferCountry(req);
        return { ok: true };
      });
      await app.inject({ method: "GET", url: "/probe", headers: { "x-vercel-ip-country": "DE" } });
      expect(captured).toBe("DE");
      await app.inject({ method: "GET", url: "/probe", headers: { "cf-ipcountry": "FR" } });
      expect(captured).toBe("FR");
      await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-openmatch-country": "ES" },
      });
      expect(captured).toBe("ES");
      // Vercel wins over Cloudflare when both are present.
      await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-vercel-ip-country": "DE", "cf-ipcountry": "FR" },
      });
      expect(captured).toBe("DE");
    } finally {
      await app.close();
    }
  });

  it("checkCountry: a sanctioned inferred country beats a launch-geography declaration", async () => {
    const app = await build();
    try {
      let decision: ReturnType<typeof app.checkCountry> | null = null;
      app.get("/probe", async (req) => {
        decision = app.checkCountry(req, "US");
        return { ok: true };
      });
      await app.inject({ method: "GET", url: "/probe", headers: { "x-vercel-ip-country": "IR" } });
      expect(decision?.allow).toBe(false);
      if (decision && !decision.allow) {
        // Iran is in both sanctions and LGBTQ lists — policy returns the
        // first match. Either is correct as long as we block.
        expect(["sanctions", "lgbtq_criminalised"]).toContain(decision.reason);
      }
    } finally {
      await app.close();
    }
  });

  it("checkCountry: declared country can downgrade a passing inference", async () => {
    const app = await build();
    try {
      let decision: ReturnType<typeof app.checkCountry> | null = null;
      app.get("/probe", async (req) => {
        decision = app.checkCountry(req, "NG");
        return { ok: true };
      });
      // Inferred US (allowed), but declared Nigeria (LGBTQ-criminalised) wins.
      await app.inject({ method: "GET", url: "/probe", headers: { "x-vercel-ip-country": "US" } });
      expect(decision?.allow).toBe(false);
      if (decision && !decision.allow) {
        expect(decision.reason).toBe("lgbtq_criminalised");
      }
    } finally {
      await app.close();
    }
  });

  it("checkCountry: launch-geography pair allows", async () => {
    const app = await build();
    try {
      let decision: ReturnType<typeof app.checkCountry> | null = null;
      app.get("/probe", async (req) => {
        decision = app.checkCountry(req, "DE");
        return { ok: true };
      });
      await app.inject({ method: "GET", url: "/probe", headers: { "x-vercel-ip-country": "DE" } });
      expect(decision?.allow).toBe(true);
    } finally {
      await app.close();
    }
  });
});
