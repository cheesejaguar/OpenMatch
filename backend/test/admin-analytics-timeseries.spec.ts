import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

const app = await buildServer();
const fastify = app;

afterAll(async () => {
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

async function createAdmin(roleNames: string[]) {
  const admin = await testPrisma.adminUser.create({
    data: { email: `admin-ts-${Date.now()}@openmatch.local`, displayName: "A" },
  });
  for (const r of roleNames) {
    const role = await testPrisma.adminRole.findUnique({ where: { name: r } });
    if (!role) continue;
    await testPrisma.adminUserRole.create({
      data: { adminUserId: admin.id, adminRoleId: role.id },
    });
  }
  return { token: fastify.signAdminAccessToken(admin.id) };
}

describe("admin analytics timeseries", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles();
  });

  it("requires admin auth", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/timeseries",
    });
    expect(res.statusCode).toBe(401);
  });

  it("buckets signups by day", async () => {
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 86_400_000);

    const u1 = await createUser({ displayName: "U1" });
    const u2 = await createUser({ displayName: "U2" });
    const u3 = await createUser({ displayName: "U3" });
    await testPrisma.user.update({ where: { id: u1.id }, data: { createdAt: yesterday } });
    await testPrisma.user.update({ where: { id: u2.id }, data: { createdAt: today } });
    await testPrisma.user.update({ where: { id: u3.id }, data: { createdAt: today } });

    const { token } = await createAdmin(["viewer"]);
    const from = new Date(yesterday.getTime() - 86_400_000).toISOString();
    const to = new Date(today.getTime() + 86_400_000).toISOString();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/v1/admin/analytics/timeseries?metric=signups&granularity=day&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { points: Array<{ t: string; v: number }> };
    const sum = body.points.reduce((acc, p) => acc + p.v, 0);
    expect(sum).toBe(3);
    expect(body.points.length).toBeGreaterThanOrEqual(2);
  });
});
