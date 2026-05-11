import type { AccountStatus, Prisma, PrismaClient, ReasonCode } from "@prisma/client";
import {
  type PermissionSet,
  serializeUserDetail,
  serializeUserSummary,
} from "../../lib/admin/serialize.js";

export interface SearchUsersArgs {
  query?: string;
  status?: AccountStatus;
  hasReports?: boolean;
  limit: number;
  cursor?: string;
}

export async function searchUsers(
  prisma: PrismaClient,
  args: SearchUsersArgs,
  perms: PermissionSet,
) {
  const where: Prisma.UserWhereInput = {};
  if (args.status) where.status = args.status;
  if (args.query && args.query.trim().length > 0) {
    const q = args.query.trim();
    where.OR = [{ id: q }, { profile: { displayName: { contains: q, mode: "insensitive" } } }];
  }
  if (args.hasReports) {
    where.reportsAbout = { some: {} };
  }
  const take = Math.min(args.limit, 100) + 1;
  const rows = await prisma.user.findMany({
    where,
    include: {
      profile: true,
      _count: { select: { reportsAbout: true } },
    },
    take,
    ...(args.cursor ? { skip: 1, cursor: { id: args.cursor } } : {}),
    orderBy: { createdAt: "desc" },
  });
  const nextCursor = rows.length > take - 1 ? rows[take - 1]!.id : null;
  const page = rows.slice(0, take - 1);
  return {
    users: page.map((u) => serializeUserSummary(u, perms)),
    nextCursor,
  };
}

export async function getUserDetail(prisma: PrismaClient, userId: string, perms: PermissionSet) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: { include: { photos: { orderBy: { sortOrder: "asc" } } } },
      bans: { orderBy: { bannedAt: "desc" } },
      _count: { select: { reportsAbout: true } },
    },
  });
  if (!user) return null;
  return serializeUserDetail(user, perms);
}

export interface BanUserArgs {
  userId: string;
  banType: "temporary" | "permanent" | "safety_hold";
  reasonCode: ReasonCode;
  internalNote?: string | null;
  userFacingExplanation?: string | null;
  expiresAt?: Date | null;
  revokeSessions?: boolean;
  bannedByAdminUserId: string;
}

export async function applyBan(
  prisma: PrismaClient,
  args: BanUserArgs,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const ban = await db.userBan.create({
    data: {
      userId: args.userId,
      banType: args.banType,
      reasonCode: args.reasonCode,
      internalNote: args.internalNote ?? null,
      userFacingExplanation: args.userFacingExplanation ?? null,
      bannedByAdminUserId: args.bannedByAdminUserId,
      expiresAt: args.expiresAt ?? null,
      status: "active",
    },
  });
  await db.user.update({
    where: { id: args.userId },
    data: { status: "banned", isBanned: true },
  });
  // Hide the profile from discovery as a defensive measure regardless of
  // ban type. Permanent ban removes them; suspension hides them until
  // expiry. We don't touch matches/conversations here — those stay
  // visible in the admin tool for forensics.
  await db.profile.updateMany({
    where: { userId: args.userId },
    data: { visibilityStatus: "hidden", moderationStatus: "restricted" },
  });
  if (args.revokeSessions !== false) {
    await db.session.updateMany({
      where: { userId: args.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  return ban;
}

export interface UnbanArgs {
  userId: string;
  reason: string;
  internalNote?: string | null;
  requireVerification?: boolean;
  requireProfileReview?: boolean;
  unbannedByAdminUserId: string;
}

export async function applyUnban(
  prisma: PrismaClient,
  args: UnbanArgs,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const activeBan = await db.userBan.findFirst({
    where: { userId: args.userId, status: "active" },
    orderBy: { bannedAt: "desc" },
  });
  if (!activeBan) {
    throw Object.assign(new Error("no_active_ban"), { statusCode: 409 });
  }
  const updated = await db.userBan.update({
    where: { id: activeBan.id },
    data: {
      status: "lifted",
      unbannedAt: new Date(),
      unbannedByAdminUserId: args.unbannedByAdminUserId,
      unbanReason: args.reason,
      requireVerificationOnUnban: args.requireVerification ?? false,
      requireProfileReviewOnUnban: args.requireProfileReview ?? false,
    },
  });
  await db.user.update({
    where: { id: args.userId },
    data: { status: "active", isBanned: false },
  });
  await db.profile.updateMany({
    where: { userId: args.userId },
    data: {
      visibilityStatus: args.requireProfileReview ? "hidden" : "visible",
      moderationStatus: args.requireProfileReview ? "under_review" : "reviewed_ok",
    },
  });
  return updated;
}
