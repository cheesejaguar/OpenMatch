import type { PrismaClient } from "@prisma/client";
import { CONVERSATION_PEER_SELECT } from "../lib/dto/peer-user.js";
import { getModerationProvider } from "../lib/moderation-provider.js";
import { withSpan } from "../lib/spans.js";
import { tryDispatchPush } from "./push.service.js";

// SEV-A3: explicit allow-list select for peer-visible columns. The
// previous include leaked emailHash / phoneHash / authSubject /
// dateOfBirth from every match counterpart.
export async function listConversations(prisma: PrismaClient, userId: string) {
  return prisma.conversation.findMany({
    where: {
      match: {
        OR: [{ userAId: userId }, { userBId: userId }],
        status: "active",
      },
    },
    orderBy: { updatedAt: "desc" },
    select: CONVERSATION_PEER_SELECT,
  });
}

export async function authorizedForConversation(
  prisma: PrismaClient,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { match: true },
  });
  if (!c) return false;
  if (c.status !== "active") return false;
  if (c.match.status !== "active") return false;
  return c.match.userAId === userId || c.match.userBId === userId;
}

// PERF-B3 — chat message pagination. The previous implementation
// fetched every non-deleted message in the conversation with no take
// cap and no select, returning full Message rows (moderationStatus,
// deletedAt, deliveredAt, readAt, ...) for every message ever sent.
// On a long-running match with hundreds of messages this was hundreds
// of KB on every conversation open.
//
// The new shape:
//   - defaults to `take: 50` (one page of recent history)
//   - keyset cursor on (createdAt, id) for stable pagination — see
//     comments below for why an id-only cursor isn't sufficient
//   - returns messages most-recent-first; the client reverses for
//     display order. This matches every modern chat client's "load
//     older history on scroll-up" pattern.
//   - narrow `select` of only the fields the chat UI consumes
//
// The (conversationId, createdAt) composite index already exists in the
// schema so this scan is index-supported.

export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGE_MAX_PAGE_SIZE = 100;

export interface ListMessagesOptions {
  // Keyset cursor: messageId of the oldest message currently rendered
  // by the client. When set, returns the page of messages immediately
  // BEFORE that cursor (older history). When unset, returns the most
  // recent page.
  cursor?: string;
  limit?: number;
}

export const MESSAGE_LIST_SELECT = {
  id: true,
  conversationId: true,
  senderUserId: true,
  body: true,
  createdAt: true,
  deliveredAt: true,
  readAt: true,
  moderationStatus: true,
  audioPath: true,
  audioDurationMs: true,
  reactions: {
    select: {
      userId: true,
      emoji: true,
      createdAt: true,
    },
  },
} as const;

export async function listMessages(
  prisma: PrismaClient,
  conversationId: string,
  userId: string,
  opts: ListMessagesOptions = {},
) {
  if (!(await authorizedForConversation(prisma, conversationId, userId))) {
    return null;
  }
  const take = Math.min(opts.limit ?? MESSAGE_PAGE_SIZE, MESSAGE_MAX_PAGE_SIZE);

  // Resolve the cursor's (createdAt, id) so the keyset predicate uses
  // both columns — id alone isn't strictly ordered against createdAt
  // (cuid() is monotonic enough in practice but the createdAt+id pair
  // is the unambiguous keyset).
  let cursorCreatedAt: Date | null = null;
  if (opts.cursor) {
    const cursorRow = await prisma.message.findUnique({
      where: { id: opts.cursor },
      select: { id: true, createdAt: true, conversationId: true },
    });
    // Ignore an invalid cursor (different conversation / unknown id):
    // the route would otherwise leak conversation membership info via a
    // 400 here. Returning the first page is a benign degraded behaviour.
    if (cursorRow && cursorRow.conversationId === conversationId) {
      cursorCreatedAt = cursorRow.createdAt;
    }
  }

  // Fetch the most recent `take` messages BEFORE the cursor (or the
  // tail of the conversation when no cursor). The DB-level sort is
  // DESC + LIMIT so PG can walk the (conversationId, createdAt) index
  // in reverse and stop at LIMIT. We then re-reverse in JS so the
  // returned array stays oldest-first within a page — matching the
  // shape iOS clients have rendered since the unbounded-fetch days.
  const desc = await prisma.message.findMany({
    where: {
      conversationId,
      deletedAt: null,
      ...(cursorCreatedAt
        ? {
            // strictly older than the cursor — exclude the cursor row
            // itself so the client can concatenate pages without dedupe
            OR: [
              { createdAt: { lt: cursorCreatedAt } },
              { createdAt: cursorCreatedAt, id: { lt: opts.cursor! } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: MESSAGE_LIST_SELECT,
  });
  return desc.reverse();
}

export async function postMessage(
  prisma: PrismaClient,
  conversationId: string,
  senderUserId: string,
  body: string,
) {
  return withSpan("chat.postMessage", "chat.postMessage", () =>
    postMessageInner(prisma, conversationId, senderUserId, body),
  );
}

async function postMessageInner(
  prisma: PrismaClient,
  conversationId: string,
  senderUserId: string,
  body: string,
) {
  if (!body.trim()) {
    throw Object.assign(new Error("empty_message"), { statusCode: 400 });
  }
  if (body.length > 2000) {
    throw Object.assign(new Error("message_too_long"), { statusCode: 400 });
  }
  if (!(await authorizedForConversation(prisma, conversationId, senderUserId))) {
    throw Object.assign(new Error("not_authorized"), { statusCode: 403 });
  }

  // PLATFORM-PLUGIN — run the active ModerationProvider over every
  // outbound message body. The noop default is unconditional `clean`
  // so existing behaviour is preserved when no provider is wired.
  // `block` rejects the send; `flag` lets the row through with
  // moderationStatus = under_review so the recipient still sees the
  // message and the safety queue can audit.
  const moderation = await getModerationProvider().scanText({
    text: body,
    context: "message",
  });
  if (moderation.decision === "block") {
    throw Object.assign(new Error("message_rejected_by_moderation"), { statusCode: 422 });
  }
  const moderationStatus = moderation.decision === "flag" ? "under_review" : "clean";

  const message = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: { conversationId, senderUserId, body, moderationStatus },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return m;
  });

  // OPS-1: fire message-push to the OTHER party. Best-effort.
  setImmediate(async () => {
    try {
      const convo = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { match: { select: { userAId: true, userBId: true } } },
      });
      if (!convo) return;
      const recipientId =
        convo.match.userAId === senderUserId ? convo.match.userBId : convo.match.userAId;
      tryDispatchPush(prisma, {
        userId: recipientId,
        category: "message",
        alert: { title: "New message", body: "You have a new message on OpenMatch." },
        threadId: `conversation:${conversationId}`,
      });
    } catch {
      // never fail the request because of a push lookup error
    }
  });

  return message;
}

// Voice-note insert. Mirrors postMessage's authorisation + transaction
// shape but persists the audio storage path + duration. `body` defaults
// to the empty string because existing clients render `body` as the
// bubble text; a voice-note-only message is opted into by the iOS UI
// switching to the audio rendering path when `audioPath != null`.
export async function postAudioMessage(
  prisma: PrismaClient,
  conversationId: string,
  senderUserId: string,
  args: { audioPath: string; audioCdnUrl: string; audioDurationMs: number },
) {
  if (!(await authorizedForConversation(prisma, conversationId, senderUserId))) {
    throw Object.assign(new Error("not_authorized"), { statusCode: 403 });
  }
  return prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: {
        conversationId,
        senderUserId,
        body: "",
        audioPath: args.audioPath,
        audioCdnUrl: args.audioCdnUrl,
        audioDurationMs: args.audioDurationMs,
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return m;
  });
}

// Mark a single message as read by the recipient. Idempotent — repeated
// calls keep the original `readAt` instead of bumping it (so the "Read
// at HH:mm" label doesn't churn). Also sets `deliveredAt` if it was
// somehow missed (the recipient demonstrably has the row in hand).
//
// Authorization: the caller must be a participant in the conversation
// AND must not be the sender (a sender reading their own message has
// no semantic meaning).
export async function markMessageAsRead(
  prisma: PrismaClient,
  args: { messageId: string; readerUserId: string },
): Promise<{ ok: boolean; conversationId?: string; readAt?: Date }> {
  const row = await prisma.message.findUnique({
    where: { id: args.messageId },
    select: {
      id: true,
      conversationId: true,
      senderUserId: true,
      readAt: true,
      deliveredAt: true,
    },
  });
  if (!row) return { ok: false };
  if (row.senderUserId === args.readerUserId) return { ok: false };
  if (!(await authorizedForConversation(prisma, row.conversationId, args.readerUserId))) {
    return { ok: false };
  }
  if (row.readAt) {
    return { ok: true, conversationId: row.conversationId, readAt: row.readAt };
  }
  const now = new Date();
  const updated = await prisma.message.update({
    where: { id: args.messageId },
    data: {
      readAt: now,
      deliveredAt: row.deliveredAt ?? now,
    },
    select: { readAt: true, conversationId: true },
  });
  return {
    ok: true,
    conversationId: updated.conversationId,
    readAt: updated.readAt ?? now,
  };
}

// Mark every UNREAD message in a conversation that wasn't sent by the
// reader as read. Used when the iOS client opens the conversation —
// one call clears the entire backlog instead of N round-trips.
export async function markConversationAsRead(
  prisma: PrismaClient,
  args: { conversationId: string; readerUserId: string },
): Promise<{ ok: boolean; updated: number }> {
  if (!(await authorizedForConversation(prisma, args.conversationId, args.readerUserId))) {
    return { ok: false, updated: 0 };
  }
  const now = new Date();
  const res = await prisma.message.updateMany({
    where: {
      conversationId: args.conversationId,
      senderUserId: { not: args.readerUserId },
      readAt: null,
    },
    data: { readAt: now, deliveredAt: now },
  });
  return { ok: true, updated: res.count };
}

// Reactions. The (messageId, userId, emoji) unique index makes the
// insert idempotent — concurrent taps on the same emoji from the same
// device cannot create duplicate rows.
//
// Returns the reaction row + the conversationId so the route can fan
// out a realtime event on the right channel without an extra query.
export async function addReaction(
  prisma: PrismaClient,
  args: { messageId: string; userId: string; emoji: string },
): Promise<
  | { ok: true; conversationId: string; messageId: string; userId: string; emoji: string }
  | { ok: false; reason: "not_found" | "forbidden" | "invalid_emoji" }
> {
  // Bound emoji length so a misbehaving client can't store a multi-KB
  // string. 64 bytes covers every single grapheme cluster plus skin-tone
  // / ZWJ joiner sequences that emoji 15.1 introduces.
  if (!args.emoji || args.emoji.length > 64) {
    return { ok: false, reason: "invalid_emoji" };
  }
  const message = await prisma.message.findUnique({
    where: { id: args.messageId },
    select: { id: true, conversationId: true },
  });
  if (!message) return { ok: false, reason: "not_found" };
  if (!(await authorizedForConversation(prisma, message.conversationId, args.userId))) {
    return { ok: false, reason: "forbidden" };
  }
  // upsert keyed by the unique triple. The where shape MUST match the
  // `@@unique([messageId, userId, emoji])` index name Prisma derives.
  await prisma.messageReaction.upsert({
    where: {
      messageId_userId_emoji: {
        messageId: args.messageId,
        userId: args.userId,
        emoji: args.emoji,
      },
    },
    create: {
      messageId: args.messageId,
      userId: args.userId,
      emoji: args.emoji,
    },
    update: {},
  });
  return {
    ok: true,
    conversationId: message.conversationId,
    messageId: args.messageId,
    userId: args.userId,
    emoji: args.emoji,
  };
}

export async function removeReaction(
  prisma: PrismaClient,
  args: { messageId: string; userId: string; emoji: string },
): Promise<
  | { ok: true; conversationId: string; messageId: string; userId: string; emoji: string }
  | { ok: false; reason: "not_found" | "forbidden" }
> {
  const message = await prisma.message.findUnique({
    where: { id: args.messageId },
    select: { id: true, conversationId: true },
  });
  if (!message) return { ok: false, reason: "not_found" };
  if (!(await authorizedForConversation(prisma, message.conversationId, args.userId))) {
    return { ok: false, reason: "forbidden" };
  }
  // deleteMany is idempotent: removing a reaction that was already
  // removed (or never existed) is a successful no-op.
  await prisma.messageReaction.deleteMany({
    where: {
      messageId: args.messageId,
      userId: args.userId,
      emoji: args.emoji,
    },
  });
  return {
    ok: true,
    conversationId: message.conversationId,
    messageId: args.messageId,
    userId: args.userId,
    emoji: args.emoji,
  };
}
