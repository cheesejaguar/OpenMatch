import type { Prisma, PrismaClient } from "@prisma/client";
import { withSpan } from "../lib/spans.js";
import { tryDispatchPush } from "./push.service.js";

const UNDO_WINDOW_MS = 5 * 60 * 1000;

export interface RecordSwipeInput {
  viewerUserId: string;
  targetUserId: string;
  decision: "like" | "reject";
  algorithmVersion: string;
  rankingConfigVersion: string;
  deckSessionId: string;
  // When true (driven by the `match_pipeline_paused` feature flag),
  // swipes are persisted and Likes are still recorded but no Match
  // row is created. Lets ops drain the moderation queue without
  // halting the swipe deck entirely.
  skipMatch?: boolean;
}

export interface RecordSwipeResult {
  // null means the swipe was a silent no-op (e.g. against a blocked user)
  // and there is nothing to undo.
  swipeId: string | null;
  matched: boolean;
  matchId?: string;
}

export async function recordSwipe(
  prisma: PrismaClient,
  input: RecordSwipeInput,
): Promise<RecordSwipeResult> {
  return withSpan("swipe.recordSwipe", "swipe.recordSwipe", () => recordSwipeInner(prisma, input));
}

async function recordSwipeInner(
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
  // PERF-B9 — issue two findUnique lookups in parallel against the
  // composite unique index on Block(blockerUserId, blockedUserId). Each
  // hits the unique index directly; the previous OR-clause findFirst
  // had inconsistent planner behaviour (audit doc / EXPLAIN — sometimes
  // a single seq filter rather than two index lookups + union).
  const [forwardBlock, reverseBlock] = await Promise.all([
    prisma.block.findUnique({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: input.viewerUserId,
          blockedUserId: input.targetUserId,
        },
      },
      select: { id: true },
    }),
    prisma.block.findUnique({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: input.targetUserId,
          blockedUserId: input.viewerUserId,
        },
      },
      select: { id: true },
    }),
  ]);
  const isBlocked = forwardBlock !== null || reverseBlock !== null;
  if (isBlocked) {
    // Silent no-op: don't record the swipe, don't reveal the block to the
    // swiper, and return null so the client cannot attempt to "undo" a
    // non-existent row.
    return { swipeId: null, matched: false };
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
      // OPS-1: outbound like with no reciprocal → "you have a new like"
      // push to the target (if their prefs allow it).
      queueLikePush(prisma, input.targetUserId);
      return { swipeId: swipe.id, matched: false };
    }
    if (input.skipMatch) {
      // Match pipeline paused: persist the swipe and the outbound Like
      // but skip the Match insert. The reciprocal Like is left in
      // "active"; when the flag flips back, the next swipe between the
      // pair will create the Match.
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

    // OPS-1: fire match-push to both participants. Best-effort —
    // failures must not roll back the swipe transaction. We dispatch
    // OUTSIDE the tx body via setImmediate so the tx commit completes
    // before push lookups run against the (potentially) replicated
    // read model.
    queueMatchPush(prisma, input.viewerUserId, input.targetUserId);

    return { swipeId: swipe.id, matched: true, matchId: match.id };
  });
}

function queueLikePush(prisma: PrismaClient, targetUserId: string): void {
  setImmediate(() => {
    tryDispatchPush(prisma, {
      userId: targetUserId,
      category: "like",
      alert: { title: "Someone likes you", body: "Open OpenMatch to see who." },
      threadId: `likes:${targetUserId}`,
    });
  });
}

function queueMatchPush(prisma: PrismaClient, userA: string, userB: string): void {
  setImmediate(() => {
    tryDispatchPush(prisma, {
      userId: userA,
      category: "match",
      alert: { title: "New match", body: "You have a new match on OpenMatch." },
      threadId: `match:${userB}`,
    });
    tryDispatchPush(prisma, {
      userId: userB,
      category: "match",
      alert: { title: "New match", body: "You have a new match on OpenMatch." },
      threadId: `match:${userA}`,
    });
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
