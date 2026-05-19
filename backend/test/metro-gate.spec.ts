import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import countryGatePlugin from "../src/plugins/country-gate.js";
import metroGatePlugin from "../src/plugins/metro-gate.js";
import { resetDb, seedTestMetroSF, testPrisma } from "./helpers/db.js";

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", testPrisma);
  await app.register(countryGatePlugin);
  await app.register(metroGatePlugin);
  return app;
}

describe("metro-gate plugin", () => {
  beforeEach(async () => {
    await resetDb();
    await seedTestMetroSF();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("allows coords inside SF Bay (US viewer)", async () => {
    const app = await build();
    try {
      let decision: Awaited<ReturnType<typeof app.checkMetro>> | null = null;
      app.get("/probe", async (req) => {
        decision = await app.checkMetro(req, {
          countryCode: "US",
          location: { lat: 37.7749, lng: -122.4194 },
        });
        return { ok: true };
      });
      await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-openmatch-country": "US" },
      });
      expect(decision?.allow).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("denies coords in NYC (out-of-metro for US)", async () => {
    const app = await build();
    try {
      let decision: Awaited<ReturnType<typeof app.checkMetro>> | null = null;
      app.get("/probe", async (req) => {
        decision = await app.checkMetro(req, {
          countryCode: "US",
          location: { lat: 40.7128, lng: -74.006 },
        });
        return { ok: true };
      });
      await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-openmatch-country": "US" },
      });
      expect(decision?.allow).toBe(false);
      if (decision && !decision.allow) {
        expect(decision.reason).toBe("outside_metro");
        expect(decision.metro).toBe("sf-bay-area");
      }
    } finally {
      await app.close();
    }
  });

  it("falls back to allow when no location is supplied", async () => {
    const app = await build();
    try {
      let decision: Awaited<ReturnType<typeof app.checkMetro>> | null = null;
      app.get("/probe", async (req) => {
        decision = await app.checkMetro(req, { countryCode: "US", location: null });
        return { ok: true };
      });
      await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-openmatch-country": "US" },
      });
      expect(decision?.allow).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("allows when no metro is configured for the country", async () => {
    const app = await build();
    try {
      let decision: Awaited<ReturnType<typeof app.checkMetro>> | null = null;
      app.get("/probe", async (req) => {
        decision = await app.checkMetro(req, {
          countryCode: "DE",
          location: { lat: 52.52, lng: 13.405 },
        });
        return { ok: true };
      });
      await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-openmatch-country": "DE" },
      });
      expect(decision?.allow).toBe(true);
    } finally {
      await app.close();
    }
  });
});
