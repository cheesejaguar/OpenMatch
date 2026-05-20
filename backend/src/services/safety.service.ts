import type { PrismaClient } from "@prisma/client";
import { ably, conversationChannel } from "../lib/realtime.js";

// SEV-M11 — Tear down the live Ably channel for a closed match so
// neither party continues to receive realtime publishes from the
// other. The token-request path (routes/realtime.ts) already scopes
// future tokens to *active* matches only, but stale subscriptions
// keep delivering until token TTL expires. We publish a sentinel
// `unmatched` event so connected clients can drop their cached
// conversation, then detach the channel server-side.
async function tearDownChannel(conversationId: string): Promise<void> {
  if (!ably) return;
  const name = conversationChannel(conversationId);
  try {
    const channel = ably.channels.get(name);
    // Sentinel event — iOS handles this by clearing the local cache.
    await channel.publish("conversation.closed", {
      conversationId,
      reason: "blocked",
      at: new Date().toISOString(),
    });
  } catch {
    // Best-effort; the application-layer check in chat.service still
    // gates new sends, so a failed Ably teardown is degraded but not
    // unsafe.
  }
}

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
  // SEV-M11 — Collect the conversation ids closed by this block so
  // we can tear down their Ably channels *outside* the transaction
  // (Ably calls go over the network and would otherwise stretch the
  // txn window). Closed conversations stay in the DB — only their
  // realtime fan-out is detached.
  const closedConversationIds: string[] = [];
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
    const affected = await tx.match.findMany({
      where: { userAId: a, userBId: b, status: "active" },
      select: { id: true, conversation: { select: { id: true } } },
    });
    for (const m of affected) {
      if (m.conversation?.id) closedConversationIds.push(m.conversation.id);
    }
    await tx.match.updateMany({
      where: { userAId: a, userBId: b, status: "active" },
      data: {
        status: "unmatched",
        unmatchedAt: new Date(),
        unmatchedByUserId: blockerUserId,
      },
    });
  });
  // SEV-M11 — Out-of-band channel teardown for each closed conversation.
  // Best-effort; failures are swallowed (the application-layer check
  // in chat.service still rejects new sends).
  await Promise.all(closedConversationIds.map((id) => tearDownChannel(id)));
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

export async function listBlockedUsers(prisma: PrismaClient, blockerUserId: string) {
  return prisma.block.findMany({
    where: { blockerUserId },
    orderBy: { createdAt: "desc" },
  });
}
