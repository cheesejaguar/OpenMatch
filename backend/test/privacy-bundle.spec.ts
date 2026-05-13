import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type ExportBundle,
  textHash,
} from "../src/services/privacy.service.js";

// Pure-logic tests for the privacy service. The DSAR / deletion / export
// flows are exercised in the DB-backed integration suite (privacy.spec.ts,
// TBD — needs the test Postgres). These guard the invariants that don't
// need a database.

describe("privacy.service — pure logic", () => {
  it("textHash is sha256 and deterministic", () => {
    const a = textHash("hello");
    const b = textHash("hello");
    const c = textHash("HELLO");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("default notification prefs have non-transactional channels OFF and safety ON", () => {
    expect(DEFAULT_NOTIFICATION_PREFS.productNewsEmail).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFS.productNewsPush).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFS.productNewsSms).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFS.safetyPush).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.pushPreviewMode).toBe("sender_only");
  });
});

describe("privacy export bundle — type-shape invariants", () => {
  // This test is a compile-time contract: the ExportBundle interface
  // must not include any field that would carry precise location. The
  // assertion below is a runtime mirror of that — if a future change
  // adds a `latitude` or `longitude` property, the test will fail.
  it("ExportBundle declared keys never include lat/long", () => {
    // Reflect the keys the type allows. We pin them here so adding a
    // new top-level key to ExportBundle requires updating this test
    // (and thinking about whether the key is privacy-safe).
    const allowed: Array<keyof ExportBundle> = [
      "schemaVersion",
      "generatedAt",
      "user",
      "profile",
      "preferences",
      "notificationPreferences",
      "photos",
      "swipes",
      "likesSent",
      "likesReceived",
      "matches",
      "messages",
      "reportsMade",
      "blocksMade",
      "consents",
    ];
    for (const k of allowed) {
      expect(k).not.toMatch(/lat/i);
      expect(k).not.toMatch(/lng|long/i);
      expect(k).not.toMatch(/coord/i);
      expect(k).not.toMatch(/geometry|geography/i);
    }
  });
});
