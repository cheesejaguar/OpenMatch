import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDb, seedTestMetroSF, testPrisma } from "./helpers/db.js";

// ADMIN-3 geography buckets. Place three users at coordinates that
// land in two distinct 0.05° bins inside the SF metro, plus one user
// far outside the radius which must be excluded.

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
    data: { email: `admin-geo-${Date.now()}@openmatch.local`, displayName: "A" },
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

describe("admin geography", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles();
    await seedTestMetroSF();
  });

  it("requires admin auth", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/geography",
    });
    expect(res.statusCode).toBe(401);
  });

  it("aggregates users into 0.05° bins inside the metro", async () => {
    // Bin (37.75, -122.45): two users close to that center.
    const u1 = await createUser({ displayName: "Inner1", lat: 37.77, lng: -122.42 });
    const u2 = await createUser({ displayName: "Inner2", lat: 37.78, lng: -122.43 });
    // Bin (37.80, -122.40): one user.
    const u3 = await createUser({ displayName: "Inner3", lat: 37.82, lng: -122.4 });
    // Outside the 80km radius.
    await createUser({ displayName: "Outsider", lat: 40.7, lng: -74.0 });

    void u1;
    void u2;
    void u3;

    const { token } = await createAdmin(["viewer"]);
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/geography?metro=sf-bay-area",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      metro: { slug: string };
      buckets: Array<{ label: string; userCount: number; matchCount: number }>;
    };
    expect(body.metro.slug).toBe("sf-bay-area");
    const totalUsers = body.buckets.reduce((acc, b) => acc + b.userCount, 0);
    // 3 in-metro users (outsider filtered out by the radius clause).
    expect(totalUsers).toBe(3);
  });
});
