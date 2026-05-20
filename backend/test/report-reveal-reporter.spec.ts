import type { Profile, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../src/lib/admin/permissions.js";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import {
  permsFrom,
  reporterPseudonym,
  serializeRedactedReporter,
  serializeUserSummary,
} from "../src/lib/admin/serialize.js";

// SEV-M12 — Reporter-identity gating pure-logic guards.
// The DB-backed integration check (audit-log row written on reveal,
// 403 without permission) lives in the admin-rbac integration suite.

function fakeUser(overrides: Partial<User & { profile?: Profile | null }> = {}): User & {
  profile?: Profile | null;
  _count?: { reportsAbout: number };
} {
  return {
    id: "u_real_reporter_123",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    status: "active",
    dateOfBirth: new Date("1990-01-01T00:00:00Z"),
    emailHash: "sha256-hash-here",
    phoneHash: null,
    authProvider: "email",
    authSubject: null,
    isAgeVerified: true,
    isBanned: false,
    deletedAt: null,
    ...overrides,
    profile: overrides.profile ?? {
      id: "p1",
      userId: "u_real_reporter_123",
      displayName: "Alice",
      verificationStatus: "verified",
    } as unknown as Profile,
    _count: { reportsAbout: 0 },
  } as never;
}

describe("SEV-M12 — reporter identity gating", () => {
  describe("pseudonym", () => {
    it("is stable per (reportId, userId) pair", () => {
      const a = reporterPseudonym("rep_1", "u_alice");
      const b = reporterPseudonym("rep_1", "u_alice");
      expect(a).toBe(b);
    });

    it("differs across reports for the same user", () => {
      const a = reporterPseudonym("rep_1", "u_alice");
      const b = reporterPseudonym("rep_2", "u_alice");
      expect(a).not.toBe(b);
    });

    it("differs across users for the same report", () => {
      const a = reporterPseudonym("rep_1", "u_alice");
      const b = reporterPseudonym("rep_1", "u_bob");
      expect(a).not.toBe(b);
    });

    it("returns a `reporter:<8hex>` shape", () => {
      const p = reporterPseudonym("rep_xyz", "u_anything");
      expect(p).toMatch(/^reporter:[0-9a-f]{8}$/);
    });
  });

  describe("serializeRedactedReporter", () => {
    it("never exposes the real userId or displayName", () => {
      const out = serializeRedactedReporter("rep_1", fakeUser());
      expect(out.userId).not.toBe("u_real_reporter_123");
      expect(out.userId.startsWith("reporter:")).toBe(true);
      expect(out.displayName).toBe(null);
      expect(out.age).toBe(null);
      expect(out.profileStatus).toBe(null);
      expect(out.lastActiveAt).toBe(null);
      expect(out.redactedIdentity).toBe(true);
    });

    it("retains aggregate context the triager needs (status, verification, reportCount)", () => {
      const out = serializeRedactedReporter(
        "rep_1",
        fakeUser({ status: "active", isBanned: false }),
      );
      expect(out.status).toBe("active");
      expect(out.isBanned).toBe(false);
      expect(out.verificationStatus).toBe("verified");
      expect(out.reportCount).toBe(0);
    });

    it("contrasts with full summary — full has the real id and display name", () => {
      const perms = permsFrom([PERMISSIONS.USER_READ_FULL_PROFILE]);
      const full = serializeUserSummary(fakeUser(), perms);
      const redacted = serializeRedactedReporter("rep_1", fakeUser());
      expect(full.userId).toBe("u_real_reporter_123");
      expect(redacted.userId).not.toBe(full.userId);
      expect(redacted.displayName).toBe(null);
    });
  });

  describe("role grants", () => {
    it("moderator does NOT have REPORT_READ_REPORTER_IDENTITY", () => {
      const role = ADMIN_ROLE_DEFINITIONS.find((r) => r.name === "moderator");
      expect(role).toBeDefined();
      expect(role!.permissions).not.toContain(PERMISSIONS.REPORT_READ_REPORTER_IDENTITY);
      expect(role!.permissions).not.toContain(PERMISSIONS.REPORT_REVEAL_REPORTER);
    });

    it("senior_moderator has BOTH the read and the reveal permission", () => {
      const role = ADMIN_ROLE_DEFINITIONS.find((r) => r.name === "senior_moderator");
      expect(role).toBeDefined();
      expect(role!.permissions).toContain(PERMISSIONS.REPORT_READ_REPORTER_IDENTITY);
      expect(role!.permissions).toContain(PERMISSIONS.REPORT_REVEAL_REPORTER);
    });

    it("trust_safety_admin has BOTH the read and the reveal permission", () => {
      const role = ADMIN_ROLE_DEFINITIONS.find((r) => r.name === "trust_safety_admin");
      expect(role).toBeDefined();
      expect(role!.permissions).toContain(PERMISSIONS.REPORT_READ_REPORTER_IDENTITY);
      expect(role!.permissions).toContain(PERMISSIONS.REPORT_REVEAL_REPORTER);
    });

    it("viewer has neither", () => {
      const role = ADMIN_ROLE_DEFINITIONS.find((r) => r.name === "viewer");
      expect(role!.permissions).not.toContain(PERMISSIONS.REPORT_READ_REPORTER_IDENTITY);
      expect(role!.permissions).not.toContain(PERMISSIONS.REPORT_REVEAL_REPORTER);
    });
  });
});
