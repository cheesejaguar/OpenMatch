import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { PERMISSIONS } from "../src/lib/admin/permissions.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// End-to-end admin smoke: login by issuing an access token directly,
// then walk through search → detail → ban → unban → audit verification.
// Doesn't go through the email magic-link round-trip — that's covered by
// the consumer auth.spec.ts pattern and the unit tests for
// services/admin/auth.service.ts.

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
      create: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      },
      update: {
        description: role.description,
        permissions: role.permissions,
      },
    });
  }
}

async function createAdmin(email: string, roleNames: string[]) {
  const admin = await testPrisma.adminUser.create({
    data: { email, displayName: email },
  });
  for (const roleName of roleNames) {
    const role = await testPrisma.adminRole.findUnique({ where: { name: roleName } });
    if (!role) continue;
    await testPrisma.adminUserRole.create({
      data: { adminUserId: admin.id, adminRoleId: role.id },
    });
  }
  const token = fastify.signAdminAccessToken(admin.id);
  return { admin, token };
}

describe("admin RBAC", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles();
  });

  it("denies viewer from viewing full profile and writes an access_denied audit row", async () => {
    const target = await createUser({ displayName: "Target" });
    const { admin, token } = await createAdmin("viewer@openmatch.local", ["viewer"]);

    const res = await fastify.inject({
      method: "GET",
      url: `/api/v1/admin/users/${target.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ required: PERMISSIONS.USER_READ_FULL_PROFILE });

    const audits = await testPrisma.adminAuditLog.findMany({
      where: { adminUserId: admin.id, eventType: "access_denied" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("trust_safety_admin can ban, unban, and audit rows are written", async () => {
    const target = await createUser({ displayName: "Spammer" });
    const { admin, token } = await createAdmin("tsa@openmatch.local", ["trust_safety_admin"]);

    const ban = await fastify.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/ban`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: "permanent",
        reasonCode: "scam_or_spam",
        internalNote: "blasting links",
      },
    });
    expect(ban.statusCode).toBe(200);

    const fresh = await testPrisma.user.findUnique({ where: { id: target.id } });
    expect(fresh?.isBanned).toBe(true);
    expect(fresh?.status).toBe("banned");

    const userBan = await testPrisma.userBan.findFirst({
      where: { userId: target.id, status: "active" },
    });
    expect(userBan?.bannedByAdminUserId).toBe(admin.id);

    const unban = await fastify.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/unban`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "appeal upheld" },
    });
    expect(unban.statusCode).toBe(200);

    const after = await testPrisma.user.findUnique({ where: { id: target.id } });
    expect(after?.isBanned).toBe(false);
    expect(after?.status).toBe("active");

    const audits = await testPrisma.adminAuditLog.findMany({
      where: { adminUserId: admin.id },
      orderBy: { createdAt: "asc" },
    });
    const eventTypes = audits.map((a) => a.eventType);
    expect(eventTypes).toContain("user_banned");
    expect(eventTypes).toContain("user_unbanned");
  });

  it("requires access reason to read arbitrary conversation messages", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const match = await testPrisma.match.create({
      data: { userAId: a.id, userBId: b.id, status: "active" },
    });
    const convo = await testPrisma.conversation.create({
      data: { matchId: match.id, status: "active" },
    });
    await testPrisma.message.create({
      data: { conversationId: convo.id, senderUserId: a.id, body: "hello" },
    });

    const { token } = await createAdmin("sm@openmatch.local", ["senior_moderator"]);

    const noGrant = await fastify.inject({
      method: "GET",
      url: `/api/v1/admin/conversations/${convo.id}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(noGrant.statusCode).toBe(412);
    expect(noGrant.json()).toMatchObject({ error: "access_reason_required" });

    const grant = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/access-grants",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        entityType: "conversation",
        entityId: convo.id,
        reason: "scam_investigation",
      },
    });
    expect(grant.statusCode).toBe(200);
    const { accessGrantId } = grant.json() as { accessGrantId: string };

    const withGrant = await fastify.inject({
      method: "GET",
      url: `/api/v1/admin/conversations/${convo.id}/messages?accessGrantId=${accessGrantId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(withGrant.statusCode).toBe(200);
    const body = withGrant.json() as { messages: Array<{ body: string }> };
    expect(body.messages[0]?.body).toBe("hello");

    // Subsequent audit row must reference the grant.
    const audits = await testPrisma.adminAuditLog.findMany({
      where: { eventType: "message_viewed" },
    });
    expect(audits[0]?.sensitiveAccessGrantId).toBe(accessGrantId);
    expect(audits[0]?.accessReason).toBe("scam_investigation");
  });
});
