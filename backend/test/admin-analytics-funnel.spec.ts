import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// ADMIN-2 funnel analytics. The funnel mixes AnalyticsEvent rows
// (client-side telemetry) with server-side derived steps (User /
// SwipeAction / Match / Message). The happy-path test seeds three
// users at different points of the funnel and verifies counts cascade
// correctly.

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

async function createAdminWithRoles(email: string, roleNames: string[]) {
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

describe("admin analytics funnel + retention + timeseries", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles();
  });

  it("requires admin auth", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/funnel",
    });
    expect(res.statusCode).toBe(401);
  });

  it("counts users by funnel step and computes conversion ratios", async () => {
    // Three users — A opened the app only; B got to signup_completed;
    // C completed onboarding and sent a message.
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const c = await createUser({ displayName: "C" });

    const now = new Date();
    await testPrisma.analyticsEvent.createMany({
      data: [
        { userId: a.id, eventName: "app_opened", serverTs: now },
        { userId: b.id, eventName: "app_opened", serverTs: now },
        { userId: b.id, eventName: "signup.email_started", serverTs: now },
        { userId: b.id, eventName: "signup.email_verified", serverTs: now },
        { userId: c.id, eventName: "app_opened", serverTs: now },
        { userId: c.id, eventName: "signup.email_started", serverTs: now },
        { userId: c.id, eventName: "signup.email_verified", serverTs: now },
        { userId: c.id, eventName: "onboarding.completed", serverTs: now },
      ],
    });
    // Server-side: C swipes, matches with B, sends a message.
    await testPrisma.swipeAction.create({
      data: {
        viewerUserId: c.id,
        targetUserId: b.id,
        decision: "like",
        algorithmVersion: "test",
        rankingConfigVersion: "test",
        deckSessionId: "ds",
      },
    });
    const match = await testPrisma.match.create({
      data: { userAId: c.id, userBId: b.id, status: "active" },
    });
    const convo = await testPrisma.conversation.create({
      data: { matchId: match.id, status: "active" },
    });
    await testPrisma.message.create({
      data: { conversationId: convo.id, senderUserId: c.id, body: "hi" },
    });

    const { token } = await createAdminWithRoles("viewer-funnel@openmatch.local", ["viewer"]);
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/funnel",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      steps: Array<{ name: string; count: number; conversionFromPrior: number | null }>;
    };
    const stepsByName = new Map(body.steps.map((s) => [s.name, s.count]));
    expect(stepsByName.get("app_opened")).toBe(3);
    expect(stepsByName.get("signup_started")).toBe(2);
    expect(stepsByName.get("signup_completed")).toBe(2);
    // user_created counts every User row regardless of analytics events.
    expect(stepsByName.get("user_created")).toBe(3);
    expect(stepsByName.get("onboarding_completed")).toBe(1);
    expect(stepsByName.get("first_swipe")).toBe(1);
    expect(stepsByName.get("first_match")).toBe(2); // both sides of the match
    expect(stepsByName.get("first_message")).toBe(1);

    // Conversion ratios: signup_started / app_opened = 2/3
    const signupStarted = body.steps.find((s) => s.name === "signup_started")!;
    expect(signupStarted.conversionFromPrior).toBeCloseTo(2 / 3, 5);
  });
});
