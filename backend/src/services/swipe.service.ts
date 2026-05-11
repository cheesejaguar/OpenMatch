import type { Prisma, PrismaClient } from "@prisma/client";

const UNDO_WINDOW_MS = 5 * 60 * 1000;

export interface RecordSwipeInput {
  viewerUserId: string;
  targetUserId: string;
  decision: "like" | "reject";
  algorithmVersion: string;
  rankingConfigVersion: string;
  deckSessionId: string;
}

export interface RecordSwipeResult {
  swipeId: string;
  matched: boolean;
  matchId?: string;
}

export async function recordSwipe(
  prisma: PrismaClient,
  input: RecordSwipeInput,
): Promise<RecordSwipeResult> {
  if (input.viewerUserId === input.targetUserId) {
    const err: NodeJS.ErrnoException & { statusCode?: number } = new Error("cannot_swipe_self");
    err.statusCode = 400;
    throw err;
  }
  // Reject if blocked either direction. Treat as silent no-op rather than 4xx
  // to avoid leaking block existence to the swiper.
  const isBlocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerUserId: input.viewerUserId, blockedUserId: input.targetUserId },
        { blockerUserId: input.targetUserId, blockedUserId: input.viewerUserId },
      ],
    },
  });
  if (isBlocked) {
    const placeholderId = `noop-${Date.now()}`;
    return { swipeId: placeholderId, matched: false };
  }

  return prisma.$transaction(async (tx) => {
    const swipe = await tx.swipeAction.create({
      data: {
        viewerUserId: input.viewerUserId,
        targetUserId: input.targetUserId,
        decision: input.decision,
        algorithmVersion: input.algorithmVersion,
        rankingConfigVersion: input.rankingConfigVersion,
        deckSessionId: input.deckSessionId,
      },
    });

    if (input.decision !== "like") {
      return { swipeId: swipe.id, matched: false };
    }

    // Upsert our outbound like.
    await tx.like.upsert({
      where: {
        fromUserId_toUserId: {
          fromUserId: input.viewerUserId,
          toUserId: input.targetUserId,
        },
      },
      create: {
        fromUserId: input.viewerUserId,
        toUserId: input.targetUserId,
        status: "active",
      },
      update: { status: "active", withdrawnAt: null },
    });

    // Is there a reciprocal active like?
    const reciprocal = await tx.like.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: input.targetUserId,
          toUserId: input.viewerUserId,
        },
      },
    });
    if (!reciprocal || reciprocal.status === "withdrawn") {
      return { swipeId: swipe.id, matched: false };
    }

    // Order user ids canonically so the (userA, userB) unique constraint
    // never depends on who liked first.
    const [userAId, userBId] = [input.viewerUserId, input.targetUserId].sort() as [string, string];

    const match = await tx.match.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: {
        userAId,
        userBId,
        status: "active",
        conversation: { create: {} },
      },
      update: { status: "active", unmatchedAt: null, unmatchedByUserId: null },
      include: { conversation: true },
    });

    await tx.like.updateMany({
      where: {
        OR: [
          { fromUserId: input.viewerUserId, toUserId: input.targetUserId },
          { fromUserId: input.targetUserId, toUserId: input.viewerUserId },
        ],
      },
      data: { status: "matched" },
    });

    return { swipeId: swipe.id, matched: true, matchId: match.id };
  });
}

export async function undoSwipe(
  prisma: PrismaClient,
  viewerUserId: string,
  swipeId: string,
): Promise<{ undone: boolean }> {
  const swipe = await prisma.swipeAction.findUnique({ where: { id: swipeId } });
  if (!swipe || swipe.viewerUserId !== viewerUserId) {
    return { undone: false };
  }
  if (swipe.undoneAt) return { undone: false };
  if (Date.now() - swipe.createdAt.getTime() > UNDO_WINDOW_MS) {
    return { undone: false };
  }
  await prisma.$transaction(async (tx) => {
    await tx.swipeAction.update({
      where: { id: swipe.id },
      data: { undoneAt: new Date() },
    });
    if (swipe.decision === "like") {
      await tx.like.updateMany({
        where: {
          fromUserId: swipe.viewerUserId,
          toUserId: swipe.targetUserId,
          status: "active",
        },
        data: { status: "withdrawn", withdrawnAt: new Date() },
      });
    }
  });
  return { undone: true };
}

export const __forTest = {
  UNDO_WINDOW_MS,
};

export type { Prisma };
