import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { updateNotificationPreferences } from "../src/services/privacy.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// updateNotificationPreferences must record BOTH a marketingOptInAt
// and a marketingOptOutAt when a single patch contains both an opt-in
// and an opt-out (e.g. enable email, disable push). The previous logic
// suppressed the opt-out when an opt-in was present, dropping the
// CASL/TCPA-relevant opt-out event.
//
// Runs against the real Postgres test database and asserts on the
// persisted NotificationPreference row.

describe("updateNotificationPreferences — marketing opt-in/out timestamps", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function stored(userId: string) {
    return testPrisma.notificationPreference.findUniqueOrThrow({ where: { userId } });
  }

  it("creates the row with defaults on first update and records marketingOptInAt", async () => {
    const user = await createUser();
    expect(await testPrisma.notificationPreference.count({ where: { userId: user.id } })).toBe(0);

    const before = Date.now();
    await updateNotificationPreferences(testPrisma, user.id, {
      productNewsEmail: true,
      marketingOptInSource: "settings",
    });

    const row = await stored(user.id);
    expect(row.productNewsEmail).toBe(true);
    expect(row.productNewsPush).toBe(false);
    expect(row.marketingOptInSource).toBe("settings");
    expect(row.marketingOptInAt).toBeInstanceOf(Date);
    expect(row.marketingOptInAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.marketingOptOutAt).toBeNull();
  });

  it("records marketingOptOutAt when any channel is disabled", async () => {
    const user = await createUser();
    await updateNotificationPreferences(testPrisma, user.id, { productNewsPush: false });
    const row = await stored(user.id);
    expect(row.marketingOptOutAt).toBeInstanceOf(Date);
    expect(row.marketingOptInAt).toBeNull();
  });

  it("records BOTH timestamps when a patch contains both an opt-in and an opt-out", async () => {
    const user = await createUser();
    await updateNotificationPreferences(testPrisma, user.id, {
      productNewsEmail: true,
      productNewsPush: false,
    });
    const row = await stored(user.id);
    expect(row.productNewsEmail).toBe(true);
    expect(row.productNewsPush).toBe(false);
    expect(row.marketingOptInAt).toBeInstanceOf(Date);
    expect(row.marketingOptOutAt).toBeInstanceOf(Date);
    expect(row.marketingOptInAt!.getTime()).toBe(row.marketingOptOutAt!.getTime());
  });

  it("records neither when only transactional toggles change", async () => {
    const user = await createUser();
    await updateNotificationPreferences(testPrisma, user.id, { newMatchPush: false });
    const row = await stored(user.id);
    expect(row.newMatchPush).toBe(false);
    expect(row.marketingOptInAt).toBeNull();
    expect(row.marketingOptOutAt).toBeNull();
  });

  it("keeps an earlier opt-in timestamp when a later patch only opts out", async () => {
    const user = await createUser();
    await updateNotificationPreferences(testPrisma, user.id, { productNewsEmail: true });
    const optIn = (await stored(user.id)).marketingOptInAt;

    await updateNotificationPreferences(testPrisma, user.id, { productNewsEmail: false });
    const row = await stored(user.id);
    expect(row.productNewsEmail).toBe(false);
    expect(row.marketingOptInAt?.getTime()).toBe(optIn?.getTime());
    expect(row.marketingOptOutAt).toBeInstanceOf(Date);
  });
});
