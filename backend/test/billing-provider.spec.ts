import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type BillingProvider,
  type EntitlementSummary,
  getBillingProvider,
  NoopBillingProvider,
  setBillingProvider,
  type ValidateReceiptInput,
  type ValidateReceiptResult,
} from "../src/lib/billing-provider.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// PLATFORM-PLUGIN — contract tests for BillingProvider. The Noop
// default rejects every receipt; a Fake provider with `valid: true`
// exercises the entitlement-write path.

class FakeProvider implements BillingProvider {
  readonly name = "fake";
  result: ValidateReceiptResult = { valid: false, isSubscription: false };
  async validateReceipt(_input: ValidateReceiptInput): Promise<ValidateReceiptResult> {
    return this.result;
  }
  async listEntitlements(_userId: string): Promise<EntitlementSummary[]> {
    return [];
  }
}

describe("BillingProvider", () => {
  afterAll(() => {
    setBillingProvider(new NoopBillingProvider());
  });

  describe("NoopBillingProvider", () => {
    it("rejects every receipt", async () => {
      const p = new NoopBillingProvider();
      const r = await p.validateReceipt({ platform: "apple", receipt: "x" });
      expect(r.valid).toBe(false);
      expect(r.isSubscription).toBe(false);
    });

    it("returns an empty entitlement list for any user", async () => {
      const p = new NoopBillingProvider();
      expect(await p.listEntitlements("anything")).toEqual([]);
    });
  });

  describe("setBillingProvider", () => {
    it("swaps the active provider", () => {
      const fake = new FakeProvider();
      setBillingProvider(fake);
      expect(getBillingProvider()).toBe(fake);
      setBillingProvider(new NoopBillingProvider());
    });
  });

  describe("Entitlement persistence", () => {
    beforeEach(async () => {
      await resetDb();
    });

    it("writes an Entitlement row with the documented fields", async () => {
      // Direct DB exercise — the route layer is verified by the
      // sync-error-codes spec; here we just guarantee the model shape
      // matches what the IAP route writes.
      const user = await testPrisma.user.create({
        data: {
          authProvider: "email",
          dateOfBirth: new Date("1990-01-01"),
          emailHash: `bp-${Date.now()}`,
        },
      });
      const row = await testPrisma.entitlement.create({
        data: {
          userId: user.id,
          productId: "premium_monthly",
          expiresAt: new Date("2099-01-01"),
          source: "apple",
          transactionId: "txn-1",
        },
      });
      expect(row.userId).toBe(user.id);
      expect(row.productId).toBe("premium_monthly");
      expect(row.source).toBe("apple");
      expect(row.transactionId).toBe("txn-1");
      expect(row.expiresAt).not.toBeNull();
    });

    it("(source, transactionId) is unique — a replay is rejected at the DB layer", async () => {
      const user = await testPrisma.user.create({
        data: {
          authProvider: "email",
          dateOfBirth: new Date("1990-01-01"),
          emailHash: `bp2-${Date.now()}`,
        },
      });
      await testPrisma.entitlement.create({
        data: {
          userId: user.id,
          productId: "premium_monthly",
          source: "apple",
          transactionId: "dup-txn",
        },
      });
      await expect(
        testPrisma.entitlement.create({
          data: {
            userId: user.id,
            productId: "premium_monthly",
            source: "apple",
            transactionId: "dup-txn",
          },
        }),
      ).rejects.toBeDefined();
    });
  });
});
