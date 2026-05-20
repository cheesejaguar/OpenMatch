import type { PrismaClient } from "@prisma/client";
import { CONVERSATION_PEER_SELECT } from "../lib/dto/peer-user.js";
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

export async function listMessages(prisma: PrismaClient, conversationId: string, userId: string) {
  if (!(await authorizedForConversation(prisma, conversationId, userId))) {
    return null;
  }
  return prisma.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
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
  const message = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: { conversationId, senderUserId, body },
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
