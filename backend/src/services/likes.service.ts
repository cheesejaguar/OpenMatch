import type { PrismaClient } from "@prisma/client";

export async function listIncomingLikes(prisma: PrismaClient, toUserId: string) {
  const prefs = await prisma.preferences.findUnique({
    where: { userId: toUserId },
    select: { likesVisibility: true },
  });
  const visibility = prefs?.likesVisibility ?? "visible";

  if (visibility === "hidden") {
    return { visibility, count: null as number | null, likes: [] };
  }

  const likes = await prisma.like.findMany({
    where: { toUserId, status: "active" },
    orderBy: { createdAt: "desc" },
    include: {
      from: {
        include: {
          profile: { include: { photos: { orderBy: { sortOrder: "asc" } } } },
        },
      },
    },
  });

  const count = likes.length;

  if (visibility === "count_only") {
    return { visibility, count, likes: [] };
  }
  return { visibility, count, likes };
}

export async function rejectIncomingLike(prisma: PrismaClient, likeId: string, byUserId: string) {
  const like = await prisma.like.findUnique({ where: { id: likeId } });
  if (!like || like.toUserId !== byUserId) return { rejected: false };
  await prisma.like.update({
    where: { id: like.id },
    data: { status: "rejected" },
  });
  return { rejected: true };
}
