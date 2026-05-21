// BillingProvider — fork-extension surface for in-app purchase /
// subscription validation.
//
// OpenMatch core ships no monetisation. This interface exists so a fork
// can wire an Apple / Google receipt verifier without modifying the
// shared route handlers; the actual Apple StoreKit / Google Play
// validation logic ships in the Monetization scaffolding PR.
//
// What this PR ships:
//   - The provider interface + a NoopBillingProvider default.
//   - A `POST /api/v1/iap/validate` route that delegates to whichever
//     provider is selected via the `BILLING_PROVIDER` env var.
//   - An `Entitlement` Prisma model that records granted entitlements
//     so other route handlers can look up "is this user a subscriber".
//
// The noop default returns `valid: false` for every receipt — every
// user is free-tier until a fork swaps the provider.

export interface ValidateReceiptInput {
  platform: "apple" | "google";
  receipt: string;
  // Optional user context the verifier may use for audit logging /
  // signature scoping. Forks that need it can read it; the noop
  // default ignores it.
  userId?: string;
}

export interface ValidateReceiptResult {
  valid: boolean;
  productId?: string;
  expiresAt?: Date;
  transactionId?: string;
  isSubscription: boolean;
  rawProviderResponse?: unknown;
}

export interface EntitlementSummary {
  productId: string;
  expiresAt: Date | null;
}

export interface BillingProvider {
  readonly name: string;
  validateReceipt(input: ValidateReceiptInput): Promise<ValidateReceiptResult>;
  /**
   * Look up the active entitlements for a user. Default implementations
   * read from the local `Entitlement` table; bespoke providers that own
   * the source of truth (e.g. RevenueCat) may resolve from an external
   * API instead.
   */
  listEntitlements(userId: string): Promise<EntitlementSummary[]>;
}

// -------- Noop default --------------------------------------------------

export class NoopBillingProvider implements BillingProvider {
  readonly name = "noop";

  async validateReceipt(_input: ValidateReceiptInput): Promise<ValidateReceiptResult> {
    return { valid: false, isSubscription: false };
  }

  async listEntitlements(_userId: string): Promise<EntitlementSummary[]> {
    return [];
  }
}

// -------- Selector ------------------------------------------------------

let activeProvider: BillingProvider = new NoopBillingProvider();

export function setBillingProvider(p: BillingProvider): void {
  activeProvider = p;
}

export function getBillingProvider(): BillingProvider {
  return activeProvider;
}

export function configureBillingProviderFromEnv(name: string): void {
  // Only "noop" is shipped in core. Forks register their own provider
  // before calling buildServer() — at that point setBillingProvider
  // has already been called and this selector is a no-op for the
  // custom name. We keep the switch so an operator setting
  // BILLING_PROVIDER=stripe (or similar) doesn't crash boot.
  switch (name) {
    default:
      setBillingProvider(new NoopBillingProvider());
      break;
  }
}
