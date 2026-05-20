import type { PrismaClient } from "@prisma/client";
import { MATCH_PEER_SELECT } from "../lib/dto/peer-user.js";

// SEV-A3: every read that crosses the trust boundary into another
// user's data uses `select: MATCH_PEER_SELECT` (an explicit allow-list
// in src/lib/dto/peer-user.ts). The previous `include` approach
// returned every column on the included User and Profile rows,
// leaking `emailHash`, `phoneHash`, `authSubject`, raw `dateOfBirth`,
// and the PostGIS `location` geography.
export async function listMatches(prisma: PrismaClient, userId: string) {
  return prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: "active",
    },
    orderBy: { createdAt: "desc" },
    select: MATCH_PEER_SELECT,
  });
}

export async function unmatch(prisma: PrismaClient, matchId: string, byUserId: string) {
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
