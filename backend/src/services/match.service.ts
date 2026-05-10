import type { PrismaClient } from "@prisma/client";

export async function listMatches(prisma: PrismaClient, userId: string) {
  return prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: "active",
    },
    orderBy: { createdAt: "desc" },
    include: {
      conversation: {
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      userA: { include: { profile: { include: { photos: true } } } },
      userB: { include: { profile: { include: { photos: true } } } },
    },
  });
}

export async function unmatch(
  prisma: PrismaClient,
  matchId: string,
  byUserId: string,
) {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return { unmatched: false };
  if (match.userAId !== byUserId && match.userBId !== byUserId) {
    return { unmatched: false };
  }
  await prisma.match.update({
    where: { id: match.id },
    data: {
      status: "unmatched",
      unmatchedAt: new Date(),
      unmatchedByUserId: byUserId,
      conversation: { update: { status: "closed" } },
    },
  });
  return { unmatched: true };
}
