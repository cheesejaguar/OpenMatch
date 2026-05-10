import type { PrismaClient } from "@prisma/client";

export async function listConversations(
  prisma: PrismaClient,
  userId: string,
) {
  return prisma.conversation.findMany({
    where: {
      match: {
        OR: [{ userAId: userId }, { userBId: userId }],
        status: "active",
      },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      match: {
        include: {
          userA: { include: { profile: true } },
          userB: { include: { profile: true } },
        },
      },
      messages: { take: 1, orderBy: { createdAt: "desc" } },
    },
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

export async function listMessages(
  prisma: PrismaClient,
  conversationId: string,
  userId: string,
) {
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
  if (!body.trim()) {
    throw Object.assign(new Error("empty_message"), { statusCode: 400 });
  }
  if (body.length > 2000) {
    throw Object.assign(new Error("message_too_long"), { statusCode: 400 });
  }
  if (!(await authorizedForConversation(prisma, conversationId, senderUserId))) {
    throw Object.assign(new Error("not_authorized"), { statusCode: 403 });
  }
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { conversationId, senderUserId, body },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return message;
  });
}
