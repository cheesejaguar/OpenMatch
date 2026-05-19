import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// ADMIN-2 retention curves. We seed users with a fixed createdAt then
// log a day-1 activity event for half of them; the curve should
// reflect 50% D1 retention.

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
    data: { email: `admin-${Date.now()}@openmatch.local`, displayName: "A" },
  });
  for (const r of roleNames) {
    const role = await testPrisma.adminRole.findUnique({ where: { name: r } });
    if (!role) continue;
    await testPrisma.adminUserRole.create({
      data: { adminUserId: admin.id, adminRoleId: role.id },
    });
  }
  return { admin, token: fastify.signAdminAccessToken(admin.id) };
}

describe("admin analytics retention", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles();
  });

  it("requires admin auth", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/retention",
    });
    expect(res.statusCode).toBe(401);
  });

  it("computes a D1 retention point for a synthetic signup day", async () => {
    // Anchor: 3 days ago at midnight UTC so D1 is in the past.
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - 3);
    const d1Window = new Date(dayStart.getTime() + 86_400_000 + 1_000);

    // Two users, both "signed up" on dayStart. One returns on D+1.
    const u1 = await createUser({ displayName: "Stayed" });
    const u2 = await createUser({ displayName: "Churned" });
    await testPrisma.user.update({
      where: { id: u1.id },
      data: { createdAt: dayStart },
    });
    await testPrisma.user.update({
      where: { id: u2.id },
      data: { createdAt: dayStart },
    });
    await testPrisma.analyticsEvent.create({
      data: { userId: u1.id, eventName: "app_opened", serverTs: d1Window },
    });

    const { token } = await createAdmin(["viewer"]);
    const fromIso = new Date(dayStart.getTime() - 86_400_000).toISOString();
    const toIso = new Date(dayStart.getTime() + 86_400_000).toISOString();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/v1/admin/analytics/retention?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      cohorts: Array<{ signupDate: string; cohortSize: number; d1: number | null }>;
    };
    const dayKey = dayStart.toISOString().slice(0, 10);
    const cohort = body.cohorts.find((c) => c.signupDate === dayKey);
    expect(cohort).toBeDefined();
    expect(cohort!.cohortSize).toBe(2);
    expect(cohort!.d1).toBeCloseTo(0.5, 5);
  });
});
