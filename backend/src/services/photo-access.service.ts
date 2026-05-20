import type { PrismaClient } from "@prisma/client";

// Authorization layer for the photo-serve proxy (SEV-N16 / SEV-M7).
//
// A photo is viewable by the requesting user iff one of:
//   - they are the owner of the profile that owns the photo
//   - they are currently matched (status: active) with the owner AND
//     neither side has blocked the other
//
// We collapse the "blocked → 404" rule into the result so the caller
// cannot accidentally leak existence of a photo to a blocked user.

export type PhotoAccessResult =
  | { ok: true; photo: PhotoRecord }
  | { ok: false; reason: "not_found" | "forbidden" };

interface PhotoRecord {
  id: string;
  profileId: string;
  storageKey: string;
  cdnUrl: string;
  ownerUserId: string;
}

async function loadPhoto(prisma: PrismaClient, photoId: string): Promise<PhotoRecord | null> {
  const row = await prisma.profilePhoto.findUnique({
    where: { id: photoId },
    select: {
      id: true,
      profileId: true,
      storageKey: true,
      cdnUrl: true,
      profile: { select: { userId: true } },
    },
  });
  if (!row || !row.profile) return null;
  return {
    id: row.id,
    profileId: row.profileId,
    storageKey: row.storageKey,
    cdnUrl: row.cdnUrl,
    ownerUserId: row.profile.userId,
  };
}

async function blockExistsBetween(prisma: PrismaClient, a: string, b: string): Promise<boolean> {
  const row = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerUserId: a, blockedUserId: b },
        { blockerUserId: b, blockedUserId: a },
      ],
    },
    select: { id: true },
  });
  return row != null;
}

async function matchedBetween(prisma: PrismaClient, a: string, b: string): Promise<boolean> {
  const row = await prisma.match.findFirst({
    where: {
      status: "active",
      OR: [
        { userAId: a, userBId: b },
        { userAId: b, userBId: a },
      ],
    },
    select: { id: true },
  });
  return row != null;
}

export async function authorizePhotoAccess(
  prisma: PrismaClient,
  args: { photoId: string; requesterUserId: string },
): Promise<PhotoAccessResult> {
  const photo = await loadPhoto(prisma, args.photoId);
  if (!photo) return { ok: false, reason: "not_found" };

  // Owner — always allowed.
  if (photo.ownerUserId === args.requesterUserId) {
    return { ok: true, photo };
  }

  // Block check FIRST: if either side has blocked the other, surface
  // "not_found" so we never leak existence of the photo (or the owner).
  if (await blockExistsBetween(prisma, photo.ownerUserId, args.requesterUserId)) {
    return { ok: false, reason: "not_found" };
  }

  if (await matchedBetween(prisma, photo.ownerUserId, args.requesterUserId)) {
    return { ok: true, photo };
  }

  // No matching relationship — non-matched users do not get to read photos.
  // We return 403 here (not 404) because the photo demonstrably exists and
  // the requester knew its id; pretending otherwise has no privacy benefit
  // for the owner (an attacker would have had to enumerate the id) and
  // makes legitimate failure cases harder to debug.
  return { ok: false, reason: "forbidden" };
}

// Admin variant — admins with PHOTO_MODERATE (or report.read) can view any
// photo regardless of relationships. Caller is responsible for the
// permission check; this helper just loads the photo and returns
// not_found when it doesn't exist.
export async function loadPhotoForAdmin(
  prisma: PrismaClient,
  photoId: string,
): Promise<PhotoAccessResult> {
  const photo = await loadPhoto(prisma, photoId);
  if (!photo) return { ok: false, reason: "not_found" };
  return { ok: true, photo };
}
