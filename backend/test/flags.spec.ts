import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  __clearFlagsCache,
  __setFlagsCacheTtlMs,
  evaluateFlag,
  invalidateFlag,
} from "../src/lib/flags.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// Cache TTL is normally 30 s; tests shorten it so they can verify the
// expiry path without sleeping forever.

describe("feature-flag evaluator", () => {
  beforeEach(async () => {
    __clearFlagsCache();
    __setFlagsCacheTtlMs(50);
    await resetDb();
  });

  afterAll(async () => {
    __setFlagsCacheTtlMs(30_000);
    await testPrisma.$disconnect();
  });

  it("returns false for an unknown flag", async () => {
    expect(await evaluateFlag(testPrisma, "missing_flag")).toBe(false);
  });

  it("returns the stored value after a flag is created", async () => {
    await testPrisma.featureFlag.create({
      data: { key: "invite_required", enabled: true, description: "test" },
    });
    invalidateFlag("invite_required");
    expect(await evaluateFlag(testPrisma, "invite_required")).toBe(true);
  });

  it("caches the result for the configured TTL and refreshes after expiry", async () => {
    await testPrisma.featureFlag.create({
      data: { key: "signups_paused", enabled: false, description: "test" },
    });
    expect(await evaluateFlag(testPrisma, "signups_paused")).toBe(false);

    // Flip the flag in the DB; the cached value remains false until TTL
    await testPrisma.featureFlag.update({
      where: { key: "signups_paused" },
      data: { enabled: true },
    });
    expect(await evaluateFlag(testPrisma, "signups_paused")).toBe(false);

    // After TTL, the next call refreshes from the DB.
    await new Promise((r) => setTimeout(r, 75));
    expect(await evaluateFlag(testPrisma, "signups_paused")).toBe(true);
  });

  it("invalidateFlag forces a re-read on the next evaluation", async () => {
    await testPrisma.featureFlag.create({
      data: { key: "match_pipeline_paused", enabled: false, description: "test" },
    });
    expect(await evaluateFlag(testPrisma, "match_pipeline_paused")).toBe(false);

    await testPrisma.featureFlag.update({
      where: { key: "match_pipeline_paused" },
      data: { enabled: true },
    });
    invalidateFlag("match_pipeline_paused");
    expect(await evaluateFlag(testPrisma, "match_pipeline_paused")).toBe(true);
  });
});
