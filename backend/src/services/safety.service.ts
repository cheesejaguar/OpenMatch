import type { PrismaClient } from "@prisma/client";

export async function reportUser(
  prisma: PrismaClient,
  reporterUserId: string,
  reportedUserId: string,
  reason: string,
  details?: string,
  reportedProfileId?: string,
  reportedMessageId?: string,
) {
  if (reporterUserId === reportedUserId) {
    throw Object.assign(new Error("cannot_report_self"), { statusCode: 400 });
  }
  return prisma.report.create({
    data: {
      reporterUserId,
      reportedUserId,
      reason,
      details: details ?? null,
      reportedProfileId: reportedProfileId ?? null,
      reportedMessageId: reportedMessageId ?? null,
    },
  });
}

export async function blockUser(
  prisma: PrismaClient,
  blockerUserId: string,
  blockedUserId: string,
) {
  if (blockerUserId === blockedUserId) {
    throw Object.assign(new Error("cannot_block_self"), { statusCode: 400 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.block.upsert({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId,
          blockedUserId,
        },
      },
      create: { blockerUserId, blockedUserId },
      update: {},
    });
    // Close any active match in either direction.
    const [a, b] = [blockerUserId, blockedUserId].sort();
    await tx.match.updateMany({
      where: { userAId: a, userBId: b, status: "active" },
      data: {
        status: "unmatched",
        unmatchedAt: new Date(),
        unmatchedByUserId: blockerUserId,
      },
    });
  });
}

export async function unblockUser(
  prisma: PrismaClient,
  blockerUserId: string,
  blockedUserId: string,
) {
  await prisma.block.deleteMany({
    where: { blockerUserId, blockedUserId },
  });
}

export async function listBlockedUsers(
  prisma: PrismaClient,
  blockerUserId: string,
) {
  return prisma.block.findMany({
    where: { blockerUserId },
    orderBy: { createdAt: "desc" },
  });
}
