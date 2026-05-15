import { describe, expect, it, vi } from "vitest";
import { updateNotificationPreferences } from "../src/services/privacy.service.js";

// updateNotificationPreferences must record BOTH a marketingOptInAt
// and a marketingOptOutAt when a single patch contains both an opt-in
// and an opt-out (e.g. enable email, disable push). The previous logic
// suppressed the opt-out when an opt-in was present, dropping the
// CASL/TCPA-relevant opt-out event.
//
// This is a pure-logic test driven by a hand-rolled Prisma mock; no DB.

function mockPrisma(initial: Record<string, unknown>) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const prisma = {
    notificationPreference: {
      findUnique: vi.fn(async () => initial),
      create: vi.fn(async ({ data }) => data),
      update: vi.fn(async ({ data }) => {
        calls.push({ method: "update", args: data });
        return data;
      }),
    },
  } as never;
  return { prisma, calls };
}

describe("updateNotificationPreferences — marketing opt-in/out timestamps", () => {
  it("records marketingOptInAt when any channel is enabled", async () => {
    const { prisma, calls } = mockPrisma({ userId: "u1" });
    await updateNotificationPreferences(prisma, "u1", { productNewsEmail: true });
    expect(calls[0]?.args).toMatchObject({ marketingOptInAt: expect.any(Date) });
    expect((calls[0]?.args as Record<string, unknown>).marketingOptOutAt).toBeUndefined();
  });

  it("records marketingOptOutAt when any channel is disabled", async () => {
    const { prisma, calls } = mockPrisma({ userId: "u1" });
    await updateNotificationPreferences(prisma, "u1", { productNewsPush: false });
    expect(calls[0]?.args).toMatchObject({ marketingOptOutAt: expect.any(Date) });
    expect((calls[0]?.args as Record<string, unknown>).marketingOptInAt).toBeUndefined();
  });

  it("records BOTH timestamps when a patch contains both an opt-in and an opt-out", async () => {
    const { prisma, calls } = mockPrisma({ userId: "u1" });
    await updateNotificationPreferences(prisma, "u1", {
      productNewsEmail: true,
      productNewsPush: false,
    });
    expect(calls[0]?.args).toMatchObject({
      marketingOptInAt: expect.any(Date),
      marketingOptOutAt: expect.any(Date),
    });
  });

  it("records neither when only transactional toggles change", async () => {
    const { prisma, calls } = mockPrisma({ userId: "u1" });
    await updateNotificationPreferences(prisma, "u1", { newMatchPush: false });
    const data = calls[0]?.args as Record<string, unknown>;
    expect(data.marketingOptInAt).toBeUndefined();
    expect(data.marketingOptOutAt).toBeUndefined();
  });
});
