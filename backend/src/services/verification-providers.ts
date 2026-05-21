// Trust & safety automation — phone + ID verification provider stubs.
//
// The interface mirrors the on-device + heuristic moderation pattern:
// each provider has a stable `name`, a single async `verify(...)`, and
// returns a structured result. Today both ship as no-ops. When an
// operator signs up for Twilio Verify / Persona / Onfido they can
// register the real client and flip a feature flag.
//
// See docs/integrations/verification.md for the env vars each provider
// will read once enabled.

export interface PhoneVerifyStartResult {
  ok: boolean;
  /** Provider-side reference for `complete()`; opaque to callers. */
  externalRef?: string;
  /** When non-ok, a stable reason string the route can surface. */
  reason?: string;
}

export interface PhoneVerifyCompleteResult {
  ok: boolean;
  reason?: string;
}

export interface PhoneVerifier {
  readonly name: string;
  start(phoneNumber: string): Promise<PhoneVerifyStartResult>;
  complete(externalRef: string, code: string): Promise<PhoneVerifyCompleteResult>;
}

export interface IdVerifyStartResult {
  ok: boolean;
  /** URL the user opens (provider-hosted) to capture their ID + selfie. */
  redirectUrl?: string;
  externalRef?: string;
  reason?: string;
}

export interface IdVerifyStatus {
  ok: boolean;
  status: "pending" | "approved" | "rejected" | "unknown";
  reason?: string;
}

export interface IdVerifier {
  readonly name: string;
  start(userId: string): Promise<IdVerifyStartResult>;
  status(externalRef: string): Promise<IdVerifyStatus>;
}

// ---------------------------------------------------------------------
// No-op providers — what every fresh deployment ships with.
// ---------------------------------------------------------------------

export class NoopPhoneVerifier implements PhoneVerifier {
  readonly name = "noop";
  async start(): Promise<PhoneVerifyStartResult> {
    return { ok: false, reason: "phone_verifier_not_configured" };
  }
  async complete(): Promise<PhoneVerifyCompleteResult> {
    return { ok: false, reason: "phone_verifier_not_configured" };
  }
}

export class NoopIdVerifier implements IdVerifier {
  readonly name = "noop";
  async start(): Promise<IdVerifyStartResult> {
    return { ok: false, reason: "id_verifier_not_configured" };
  }
  async status(): Promise<IdVerifyStatus> {
    return { ok: false, status: "unknown", reason: "id_verifier_not_configured" };
  }
}

// Module singletons — production wiring would set these from env vars
// during `buildServer()`. Tests can replace via the `__set*` setters.

let phoneVerifier: PhoneVerifier = new NoopPhoneVerifier();
let idVerifier: IdVerifier = new NoopIdVerifier();

export function getPhoneVerifier(): PhoneVerifier {
  return phoneVerifier;
}

export function getIdVerifier(): IdVerifier {
  return idVerifier;
}

export function __setPhoneVerifier(p: PhoneVerifier): void {
  phoneVerifier = p;
}

export function __setIdVerifier(p: IdVerifier): void {
  idVerifier = p;
}
