import nodemailer from "nodemailer";
import { env } from "../../env.js";

// Out-of-band notifications for admin-account security events. Used by
// SEV-A7 (TOTP enrol / reset / disable should leave an audit trail
// outside the database) — best-effort fire-and-forget so the HTTP path
// is never blocked by mailer or Slack timeouts.
//
// Failure handling: every transport is wrapped in `.catch(() => {})`.
// A drop here is logged at the call site but never bubbles into the
// route response — the security event has already been written to
// AdminAuditLog by the caller, which is the authoritative record.

let mailer: nodemailer.Transporter | null = null;
function getMailer(): nodemailer.Transporter {
  if (!mailer) {
    const secure = env.SMTP_SECURE ?? env.SMTP_PORT === 465;
    mailer = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure,
      auth:
        env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      tls: { rejectUnauthorized: false },
    });
  }
  return mailer;
}

async function postToSlack(text: string): Promise<boolean> {
  if (!env.SLACK_WEBHOOK_URL) return false;
  try {
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type AdminSecurityEventKind =
  | "totp_enrolled"
  | "totp_disabled"
  | "totp_recovery_used"
  | "totp_reset_requested";

interface NotifyArgs {
  email: string;
  kind: AdminSecurityEventKind;
  /** Lightweight context dict serialised into the email body / Slack ping. */
  context?: Record<string, string | number | null | undefined>;
}

const SUBJECTS: Record<AdminSecurityEventKind, string> = {
  totp_enrolled: "OpenMatch Admin: a new 2FA device was enrolled on your account",
  totp_disabled: "OpenMatch Admin: 2FA was disabled on your account",
  totp_recovery_used: "OpenMatch Admin: a recovery code was used on your account",
  totp_reset_requested: "OpenMatch Admin: a 2FA reset was requested for your account",
};

function buildBody(kind: AdminSecurityEventKind, ctx: NotifyArgs["context"]): string {
  const ctxBlock = ctx
    ? Object.entries(ctx)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n")
    : "";
  return [
    `Security event on your OpenMatch admin account: ${kind}.`,
    "",
    ctxBlock ? `Context:\n${ctxBlock}\n` : "",
    "If you did not perform this action, contact security@openmatch.app immediately.",
    "Do not reply to this email — it is a one-way security notification.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Best-effort fire-and-forget notification. Returns a Promise that
 * always resolves (never rejects); callers can `await` to keep the
 * test loop deterministic, or `void` it in production hot paths.
 */
export async function notifyAdminSecurityEvent(args: NotifyArgs): Promise<void> {
  const subject = SUBJECTS[args.kind];
  const body = buildBody(args.kind, args.context);

  await getMailer()
    .sendMail({
      from: env.SMTP_FROM,
      to: args.email,
      subject,
      text: body,
    })
    .catch(() => undefined);

  await postToSlack(
    `:rotating_light: OpenMatch admin security event \`${args.kind}\` for \`${args.email}\``,
  ).catch(() => undefined);
}
