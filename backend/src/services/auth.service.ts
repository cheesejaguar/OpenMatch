import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import { env } from "../env.js";
import { hashIdentity, hashIp } from "../lib/hash.js";

const TOKEN_BYTES = 32;
const MAGIC_LINK_TTL_MS = env.MAGIC_LINK_TTL_SECONDS * 1000;

function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

let mailer: nodemailer.Transporter | null = null;
function getMailer(): nodemailer.Transporter {
  if (!mailer) {
    mailer = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  }
  return mailer;
}

export interface StartEmailLoginInput {
  email: string;
}

export async function startEmailLogin(
  prisma: PrismaClient,
  input: StartEmailLoginInput,
): Promise<{ challengeId: string; devToken?: string }> {
  const emailHash = hashIdentity(input.email);
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);

  const existing = await prisma.user.findFirst({ where: { emailHash } });

  // Opportunistic cleanup: delete this user's expired/consumed challenges so
  // the table doesn't bloat. Cheap because of the userId index. Safe to
  // race with concurrent challenges — we only remove rows that are no
  // longer usable.
  if (existing) {
    await prisma.authChallenge.deleteMany({
      where: {
        userId: existing.id,
        OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }],
      },
    });
  }

  const challenge = await prisma.authChallenge.create({
    data: {
      email: input.email,
      userId: existing?.id,
      tokenHash,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    },
  });

  const link = `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/v1/auth/verify?challengeId=${challenge.id}&token=${token}`;
  await getMailer()
    .sendMail({
      from: env.SMTP_FROM,
      to: input.email,
      subject: "Your OpenMatch sign-in link",
      text: `Sign in to OpenMatch by visiting this link within ${env.MAGIC_LINK_TTL_SECONDS / 60} minutes:\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    })
    .catch(() => {
      // In tests / when SMTP isn't reachable we silently swallow.
    });

  return {
    challengeId: challenge.id,
    // Dev convenience: the token is returned in non-production so the
    // iOS simulator can complete the loop without checking MailHog.
    devToken: env.NODE_ENV !== "production" ? token : undefined,
  };
}

export interface VerifyEmailLoginInput {
  challengeId: string;
  token: string;
}

export async function verifyEmailLogin(
  prisma: PrismaClient,
  input: VerifyEmailLoginInput,
): Promise<{ userId: string; isNewUser: boolean }> {
  const challenge = await prisma.authChallenge.findUnique({
    where: { id: input.challengeId },
  });
  if (!challenge) throw Object.assign(new Error("invalid_challenge"), { statusCode: 400 });
  if (challenge.consumedAt) throw Object.assign(new Error("challenge_used"), { statusCode: 400 });
  if (challenge.expiresAt.getTime() < Date.now())
    throw Object.assign(new Error("challenge_expired"), { statusCode: 400 });
  if (challenge.tokenHash !== hashToken(input.token))
    throw Object.assign(new Error("invalid_token"), { statusCode: 400 });

  await prisma.authChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  if (challenge.userId) {
    return { userId: challenge.userId, isNewUser: false };
  }

  if (!challenge.email) {
    throw Object.assign(new Error("invalid_challenge"), { statusCode: 400 });
  }
  const emailHash = hashIdentity(challenge.email);
  const existing = await prisma.user.findFirst({ where: { emailHash } });
  if (existing) {
    return { userId: existing.id, isNewUser: false };
  }
  const user = await prisma.user.create({
    data: {
      emailHash,
      authProvider: "email",
      // DOB and age verification happen during onboarding; we placeholder
      // here and require the onboarding flow to fill it in.
      dateOfBirth: new Date("2000-01-01"),
      isAgeVerified: false,
    },
  });
  return { userId: user.id, isNewUser: true };
}

export interface IssueSessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

export async function issueSession(
  prisma: PrismaClient,
  userId: string,
  signAccess: (payload: { sub: string; scope: "user" }) => string,
  ctx: IssueSessionContext = {},
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const refreshToken = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);
  await prisma.session.create({
    data: {
      userId,
      refreshToken: hashToken(refreshToken),
      expiresAt,
      userAgent: ctx.userAgent ?? null,
      ipHash: hashIp(ctx.ip),
    },
  });
  const accessToken = signAccess({ sub: userId, scope: "user" });
  return { accessToken, refreshToken, expiresAt };
}

export async function rotateRefreshToken(
  prisma: PrismaClient,
  refreshToken: string,
  signAccess: (payload: { sub: string; scope: "user" }) => string,
  ctx: IssueSessionContext & { logReuse?: (userId: string) => void } = {},
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date } | null> {
  const tokenHash = hashToken(refreshToken);
  const session = await prisma.session.findUnique({
    where: { refreshToken: tokenHash },
  });
  if (!session) return null;

  // Reuse detection: a refresh token that has already been revoked
  // implies the attacker (or the legitimate-but-out-of-sync client)
  // is presenting a stale token whose successor is already in use.
  // OWASP guidance is to revoke *all* of the user's sessions on this
  // signal — the legitimate user can sign in again. Better a forced
  // re-auth than an undetected hijack.
  if (session.revokedAt) {
    if (ctx.logReuse) ctx.logReuse(session.userId);
    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }
  if (session.expiresAt.getTime() < Date.now()) return null;

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  // Opportunistic cleanup of this user's already-expired or long-revoked
  // sessions so the table doesn't grow unbounded. Cheap with the userId
  // index. Keeps very recent revocations around for forensics — those
  // are exactly the rows that detect reuse above.
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  await prisma.session.deleteMany({
    where: {
      userId: session.userId,
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { lt: new Date(Date.now() - SEVEN_DAYS) } },
      ],
    },
  });

  return issueSession(prisma, session.userId, signAccess, ctx);
}

export async function revokeSession(prisma: PrismaClient, refreshToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { refreshToken: hashToken(refreshToken) },
    data: { revokedAt: new Date() },
  });
}

export async function listUserSessions(prisma: PrismaClient, userId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      userAgent: true,
      ipHash: true,
    },
  });
  // Never return the refreshToken hash or the raw IP.
  return sessions;
}

export async function revokeUserSession(
  prisma: PrismaClient,
  userId: string,
  sessionId: string,
): Promise<{ revoked: boolean }> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revoked: result.count > 0 };
}

export async function revokeAllUserSessions(
  prisma: PrismaClient,
  userId: string,
  options: { keepSessionId?: string } = {},
): Promise<{ revokedCount: number }> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.keepSessionId ? { NOT: { id: options.keepSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return { revokedCount: result.count };
}
