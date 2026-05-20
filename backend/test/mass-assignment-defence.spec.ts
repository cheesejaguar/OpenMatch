import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { issueSession } from "../src/services/auth.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// SEV-V1 — mass-assignment defence on PATCH /profile/me/profile.
//
// The prior implementation spread the Zod-parsed body into Prisma's
// `data`, using `as never` to escape the type system. Any column
// missing from the Zod schema today would only be safe by coincidence
// — a future schema addition + Zod schema addition (a likely pairing)
// would silently widen the user-writable surface to that column.
//
// The fixed implementation enumerates the writable columns
// explicitly. We pin the invariant here by asserting that
// `verificationStatus` and `moderationStatus` — sensitive columns
// that exist on the Profile model but are NOT in the route's
// allow-list — remain server-side after a PATCH that tries to set
// them.

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

describe("SEV-V1 — mass-assignment defence on PATCH /profile/me/profile", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses to write verificationStatus / moderationStatus via PATCH", async () => {
    const user = await createUser();
    const session = await issueSession(testPrisma, user.id, (p) => app.jwt.sign(p));

    // Snapshot the server-set columns before.
    const before = await testPrisma.profile.findUnique({
      where: { userId: user.id },
      select: { verificationStatus: true, moderationStatus: true },
    });
    expect(before?.verificationStatus).toBe("unverified");
    expect(before?.moderationStatus).toBe("clean");

    // PATCH attempts to escalate. Zod will silently strip the unknown
    // keys (the schema only allow-lists permitted columns).
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/profile/me/profile",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "x-vercel-ip-country": "US",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        displayName: "Updated",
        // attacker-controlled keys — must not be writable
        verificationStatus: "verified",
        moderationStatus: "reviewed_ok",
      }),
    });
    expect([200, 400]).toContain(res.statusCode);

    const after = await testPrisma.profile.findUnique({
      where: { userId: user.id },
      select: { verificationStatus: true, moderationStatus: true },
    });
    expect(after?.verificationStatus).toBe("unverified");
    expect(after?.moderationStatus).toBe("clean");
  });
});
