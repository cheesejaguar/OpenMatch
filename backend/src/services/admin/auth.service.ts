import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import { env } from "../../env.js";

const TOKEN_BYTES = 32;

function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

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

function allowedEmails(): Set<string> {
  return new Set(
    env.ADMIN_ALLOWED_EMAILS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAdminAllowed(email: string): boolean {
  const list = allowedEmails();
  if (list.size === 0) {
    // In dev, when the allowlist is empty we still permit existing
    // AdminUser rows (e.g. the seeded admin@openmatch.local) to log in.
    // Production deployments MUST set ADMIN_ALLOWED_EMAILS.
    return env.NODE_ENV !== "production";
  }
  return list.has(email.toLowerCase());
}

export interface StartAdminLoginResult {
  challengeId: string;
  devToken?: string;
}

export async function startAdminLogin(
  prisma: PrismaClient,
  email: string,
): Promise<StartAdminLoginResult> {
  const normalized = email.toLowerCase();
  // Allow-list gate. We don't reveal whether the email is on the list:
  // unauthorized emails simply never see an email.
  if (!isEmailAdminAllowed(normalized)) {
    // Constant-time-ish: still allocate a fake challenge id so timing
    // doesn't trivially leak membership.
    return { challengeId: randomBytes(16).toString("hex") };
  }

  const admin = await prisma.adminUser.findUnique({ where: { email: normalized } });
  // In dev, auto-provision an AdminUser when the email matches the
  // allowlist but no row exists yet. In prod, require the AdminUser to
  // have been created out-of-band by a system_admin.
  let adminUserId = admin?.id ?? null;
  if (!admin && env.NODE_ENV !== "production") {
    const created = await prisma.adminUser.create({
      data: { email: normalized, displayName: normalized.split("@")[0] ?? "admin" },
    });
    adminUserId = created.id;
  }
  if (!adminUserId) {
    return { challengeId: randomBytes(16).toString("hex") };
  }
  if (admin && admin.status !== "active") {
    return { challengeId: randomBytes(16).toString("hex") };
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  await prisma.adminAuthChallenge.deleteMany({
    where: {
      email: normalized,
      OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }],
    },
  });
  const challenge = await prisma.adminAuthChallenge.create({
    data: {
      email: normalized,
      adminUserId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.ADMIN_MAGIC_LINK_TTL_SECONDS * 1000),
    },
  });

  const adminBase = env.ADMIN_CORS_ORIGIN.split(",")[0]?.trim() ?? env.APP_BASE_URL;
  const link = `${adminBase.replace(/\/+$/, "")}/login/callback?challengeId=${challenge.id}&token=${token}`;
  await getMailer()
    .sendMail({
      from: env.SMTP_FROM,
      to: normalized,
      subject: "OpenMatch admin sign-in",
      text: `Sign in to the OpenMatch admin dashboard by visiting this link within ${Math.round(env.ADMIN_MAGIC_LINK_TTL_SECONDS / 60)} minutes:\n\n${link}\n\nIf you didn't request this, ignore this email and consider notifying security.`,
    })
    .catch(() => {
      // In tests / when SMTP isn't reachable we silently swallow so the
      // route still returns successfully.
    });

  return {
    challengeId: challenge.id,
    // SEV-V13: only emit the token in development/test. The previous
    // `!== "production"` check leaked tokens in Vercel preview envs
    // (NODE_ENV=preview).
    devToken: env.NODE_ENV === "development" || env.NODE_ENV === "test" ? token : undefined,
  };
}

export interface VerifyAdminLoginResult {
  adminUserId: string;
  email: string;
}

export async function verifyAdminLogin(
  prisma: PrismaClient,
  challengeId: string,
  token: string,
): Promise<VerifyAdminLoginResult> {
  const challenge = await prisma.adminAuthChallenge.findUnique({
    where: { id: challengeId },
  });
  if (!challenge) throw Object.assign(new Error("invalid_challenge"), { statusCode: 400 });
  if (challenge.consumedAt) throw Object.assign(new Error("challenge_used"), { statusCode: 400 });
  if (challenge.expiresAt.getTime() < Date.now())
    throw Object.assign(new Error("challenge_expired"), { statusCode: 400 });
  if (challenge.tokenHash !== hashToken(token))
    throw Object.assign(new Error("invalid_token"), { statusCode: 400 });
  if (!challenge.adminUserId) {
    throw Object.assign(new Error("invalid_challenge"), { statusCode: 400 });
  }

  const admin = await prisma.adminUser.findUnique({
    where: { id: challenge.adminUserId },
  });
  if (!admin || admin.status !== "active") {
    throw Object.assign(new Error("admin_disabled"), { statusCode: 403 });
  }

  await prisma.adminAuthChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  return { adminUserId: admin.id, email: admin.email };
}

export interface AdminSessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  sessionId: string;
}

export async function issueAdminSession(
  prisma: PrismaClient,
  adminUserId: string,
  signAccess: (adminUserId: string, sessionId?: string) => string,
  meta: { userAgent?: string | null; ipHash?: string | null } = {},
): Promise<AdminSessionTokens> {
  const refreshToken = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + env.ADMIN_REFRESH_TTL_SECONDS * 1000);
  const session = await prisma.adminSession.create({
    data: {
      adminUserId,
      refreshToken: hashToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ipHash: meta.ipHash ?? null,
    },
  });
  return {
    accessToken: signAccess(adminUserId, session.id),
    refreshToken,
    expiresAt,
    sessionId: session.id,
  };
}

export interface RotateAdminSessionContext {
  userAgent?: string | null;
  ipHash?: string | null;
  /**
   * Invoked when reuse of an already-revoked refresh token is detected.
   * The service revokes the entire session family for the admin and
   * lets the caller emit a security event (Pino log, AdminAuditLog row,
   * Sentry breadcrumb, etc.).
   */
  logReuse?: (adminUserId: string) => void;
}

export async function rotateAdminSession(
  prisma: PrismaClient,
  refreshToken: string,
  signAccess: (adminUserId: string, sessionId?: string) => string,
  ctx: RotateAdminSessionContext = {},
): Promise<AdminSessionTokens | null> {
  const tokenHash = hashToken(refreshToken);
  const session = await prisma.adminSession.findUnique({ where: { refreshToken: tokenHash } });
  if (!session) return null;

  // SEV-A2: reuse detection. A refresh token that has already been
  // revoked implies one of two things:
  //   (a) the legitimate admin's client rotated, the new pair was
  //       delivered, then the network dropped the response and the
  //       client retried with the old token, OR
  //   (b) an attacker stole the refresh token, burned it for a fresh
  //       pair, and the legitimate client just rotated with the now-
  //       stale-to-them old token.
  // OWASP guidance is to assume (b) and revoke the entire session
  // family so the attacker is kicked too. The legitimate admin can
  // sign in again. We mirror the consumer flow in auth.service.ts.
  if (session.revokedAt) {
    if (ctx.logReuse) ctx.logReuse(session.adminUserId);
    await prisma.adminSession.updateMany({
      where: { adminUserId: session.adminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Best-effort audit log; never blocks the security response. We
    // snapshot the roles inline rather than passing a context object
    // because reuse detection can happen on a token that never
    // authenticated — there's no request-scoped principal available.
    const admin = await prisma.adminUser
      .findUnique({
        where: { id: session.adminUserId },
        include: { roles: { include: { adminRole: true } } },
      })
      .catch(() => null);
    const roleSnapshot = admin ? admin.roles.map((r) => r.adminRole.name).join(",") : "";
    await prisma.adminAuditLog
      .create({
        data: {
          adminUserId: session.adminUserId,
          adminRoleSnapshot: roleSnapshot,
          eventType: "admin_refresh_reuse",
          ipHash: ctx.ipHash ?? null,
          userAgent: ctx.userAgent ?? null,
          metadata: { sessionId: session.id },
        },
      })
      .catch(() => undefined);
    return null;
  }
  if (session.expiresAt.getTime() < Date.now()) {
    return null;
  }
  // Rotation preserves the prior session's 2FA-elevation state so the
  // admin doesn't get prompted for a TOTP code every 15 minutes.
  const meta = { userAgent: ctx.userAgent, ipHash: ctx.ipHash };
  const refreshed = await issueAdminSession(prisma, session.adminUserId, signAccess, meta);
  if (session.twoFactorAt) {
    await prisma.adminSession.update({
      where: { id: refreshed.sessionId },
      data: { twoFactorAt: session.twoFactorAt },
    });
  }
  await prisma.adminSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  return refreshed;
}

export async function revokeAdminSession(
  prisma: PrismaClient,
  refreshToken: string,
): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await prisma.adminSession.updateMany({
    where: { refreshToken: tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
