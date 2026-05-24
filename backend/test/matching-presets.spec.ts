import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import {
  __clearMatchingPresetsCache,
  __setMatchingPresetsCacheTtlMs,
  getPresetCatalog,
  resolveActivePresetKey,
} from "../src/lib/matching-presets.js";
import { buildServer } from "../src/server.js";
import { resetDb, testPrisma } from "./helpers/db.js";

const app = await buildServer();
const fastify = app;

afterAll(async () => {
  __setMatchingPresetsCacheTtlMs(30_000);
  await fastify.close();
  await testPrisma.$disconnect();
});

async function seedRoles() {
  for (const role of ADMIN_ROLE_DEFINITIONS) {
    await testPrisma.adminRole.upsert({
      where: { name: role.name },
      create: { name: role.name, description: role.description, permissions: role.permissions },
      update: { description: role.description, permissions: role.permissions },
    });
  }
}

async function adminWithRoles(email: string, roleNames: string[]) {
  const admin = await testPrisma.adminUser.create({ data: { email, displayName: email } });
  for (const r of roleNames) {
    const role = await testPrisma.adminRole.findUnique({ where: { name: r } });
    if (!role) continue;
    await testPrisma.adminUserRole.create({
      data: { adminUserId: admin.id, adminRoleId: role.id },
    });
  }
  return { admin, token: fastify.signAdminAccessToken(admin.id) };
}

const VALID_PRESET = {
  key: "test-preset",
  label: "Test preset",
  description: "A preset created in tests.",
  strategyId: "weighted-sum",
  weights: { distance: 0.5, activity: 0.2 },
  enabled: true,
  isDefault: false,
  sortOrder: 5,
};

describe("matching-presets cache lib", () => {
  beforeEach(async () => {
    __clearMatchingPresetsCache();
    __setMatchingPresetsCacheTtlMs(50);
    await resetDb();
  });

  it("falls back to the built-in catalog when the table is empty", async () => {
    const catalog = await getPresetCatalog(testPrisma);
    expect(catalog.defaultKey).toBe("balanced");
    expect(catalog.presets.map((p) => p.key)).toContain("nearby-first");
  });

  it("returns enabled DB presets and honors the default flag", async () => {
    await testPrisma.matchingPreset.createMany({
      data: [
        {
          key: "a",
          label: "A",
          description: "x",
          strategyId: "weighted-sum",
          weights: {},
          enabled: true,
          isDefault: false,
          sortOrder: 1,
        },
        {
          key: "b",
          label: "B",
          description: "y",
          strategyId: "reciprocal",
          weights: { reciprocity: 0.5 },
          enabled: true,
          isDefault: true,
          sortOrder: 2,
        },
        {
          key: "c",
          label: "C",
          description: "z",
          strategyId: "weighted-sum",
          weights: {},
          enabled: false,
          isDefault: false,
          sortOrder: 3,
        },
      ],
    });
    __clearMatchingPresetsCache();
    const catalog = await getPresetCatalog(testPrisma);
    expect(catalog.presets.map((p) => p.key).sort()).toEqual(["a", "b"]);
    expect(catalog.defaultKey).toBe("b");
  });

  it("resolveActivePresetKey returns the default for unknown/disabled selections", () => {
    const catalog = {
      presets: [{ key: "a", label: "A", description: "", strategyId: "weighted-sum", weights: {} }],
      defaultKey: "a",
    };
    expect(resolveActivePresetKey(catalog, "a")).toBe("a");
    expect(resolveActivePresetKey(catalog, "gone")).toBe("a");
    expect(resolveActivePresetKey(catalog, null)).toBe("a");
  });
});

describe("admin matching-presets routes", () => {
  beforeEach(async () => {
    __clearMatchingPresetsCache();
    await resetDb();
    await seedRoles();
  });

  it("requires admin auth", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/v1/admin/matching-presets" });
    expect(res.statusCode).toBe(401);
  });

  it("forbids admins without the matching_preset.manage permission", async () => {
    const { token } = await adminWithRoles("viewer-mp@openmatch.local", ["viewer"]);
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/matching-presets",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates a preset and writes an audit row", async () => {
    const { token } = await adminWithRoles("sysadmin-mp@openmatch.local", ["system_admin"]);
    const res = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/matching-presets",
      headers: { authorization: `Bearer ${token}` },
      payload: VALID_PRESET,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("test-preset");

    const row = await testPrisma.matchingPreset.findUnique({ where: { key: "test-preset" } });
    expect(row?.strategyId).toBe("weighted-sum");
    const audit = await testPrisma.adminAuditLog.findFirst({
      where: { eventType: "matching_preset_created" },
    });
    expect(audit).toBeTruthy();
  });

  it("rejects an unknown weight key", async () => {
    const { token } = await adminWithRoles("sysadmin-mp2@openmatch.local", ["system_admin"]);
    const res = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/matching-presets",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...VALID_PRESET, key: "bad-weights", weights: { bogusKey: 0.5 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown strategy id", async () => {
    const { token } = await adminWithRoles("sysadmin-mp3@openmatch.local", ["system_admin"]);
    const res = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/matching-presets",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...VALID_PRESET, key: "bad-strategy", strategyId: "made-up" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("setting a preset as default demotes all others", async () => {
    const { token } = await adminWithRoles("sysadmin-mp4@openmatch.local", ["system_admin"]);
    await testPrisma.matchingPreset.create({
      data: {
        key: "old-default",
        label: "Old",
        description: "x",
        strategyId: "weighted-sum",
        weights: {},
        enabled: true,
        isDefault: true,
        sortOrder: 0,
      },
    });
    const res = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/matching-presets",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...VALID_PRESET, key: "new-default", isDefault: true },
    });
    expect(res.statusCode).toBe(200);
    const old = await testPrisma.matchingPreset.findUnique({ where: { key: "old-default" } });
    const fresh = await testPrisma.matchingPreset.findUnique({ where: { key: "new-default" } });
    expect(old?.isDefault).toBe(false);
    expect(fresh?.isDefault).toBe(true);
  });
});
