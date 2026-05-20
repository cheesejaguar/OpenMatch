// SEV-N1 — SMTP transport options helper.
//
// The previous nodemailer transports unconditionally set
// `tls: { rejectUnauthorized: false }`, which let any active network
// attacker between the function and the SMTP relay present a forged
// cert and capture the plaintext magic-link token from the email body.
//
// In production we require strict cert verification. The dev / test
// mail catcher (MailHog at localhost:1025) presents a self-signed cert
// so we relax verification off-production. Factoring this into a
// helper keeps both auth services consistent and unit-testable.

export interface SmtpTlsOptions {
  rejectUnauthorized: boolean;
}

/**
 * Resolve nodemailer's `tls` option for the given runtime environment.
 *
 * - `production` → `{ rejectUnauthorized: true }` (strict cert check).
 * - anything else → `{ rejectUnauthorized: false }` (self-signed
 *   MailHog accepted).
 */
export function resolveSmtpTlsOptions(nodeEnv: string): SmtpTlsOptions {
  return { rejectUnauthorized: nodeEnv === "production" };
}
