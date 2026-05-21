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
