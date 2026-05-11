import { createHash } from "node:crypto";
import { env } from "../../env.js";

// Stable, non-reversible hash for IPs / tokens stored in audit/session
// rows. Keyed with ADMIN_JWT_SECRET so two installations cannot trivially
// correlate hashes.
export function hashForAudit(value: string): string {
  return createHash("sha256").update(`${env.ADMIN_JWT_SECRET}:${value}`).digest("hex");
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}
