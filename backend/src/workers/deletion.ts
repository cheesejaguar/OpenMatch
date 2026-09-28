import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { deleteProfilePhoto } from "../lib/media.js";
import { requestContext } from "../lib/request-context.js";

// Erasure is a retryable, leased job. Storage deletion precedes database
// cleanup so failures retain the object references needed for retry. A fencing
// token prevents a stale worker from finalizing a job reclaimed after a crash.
const LEASE_MS = 5 * 60_000;
const RUN_BUDGET_MS = 45_000;

function eligibleAt(now: Date): Prisma.AccountDeletionRequestWhereInput {
  return {
    cancelledAt: null,
    gracePeriodEndsAt: { lte: now },
    OR: [
      { status: "scheduled" },
      {
        status: "in_progress",
        OR: [{ startedAt: { lte: new Date(now.getTime() - LEASE_MS) } }, { startedAt: null }],
      },
    ],
  };
}

export interface DeletionPurgeReport {
  purged: number;
  errors: number;
  durationMs: number;
  details: Array<{
    requestId: string;
    userId: string;
    ok: boolean;
    error?: string;
  }>;
}

const PLACEHOLDER_DISPLAY_NAME = "[deleted]";

export async function runDeletionPurgeOnce(prisma: PrismaClient): Promise<DeletionPurgeReport> {
  return requestContext.workerRun("deletion", () => runDeletionPurgeInner(prisma));
}

async function runDeletionPurgeInner(prisma: PrismaClient): Promise<DeletionPurgeReport> {
  const startedAt = Date.now();
  const now = new Date();

  // Eligible rows: scheduled, past their grace window, never cancelled.
  // We process up to 100 per run so a single invocation is bounded — if
  // there's a backlog, the cron will pick up the rest next tick.
  const eligible = await prisma.accountDeletionRequest.findMany({
    where: eligibleAt(now),
    orderBy: { gracePeriodEndsAt: "asc" },
    take: 100,
  });

  const details: DeletionPurgeReport["details"] = [];
  let purged = 0;
  let errors = 0;

  for (const req of eligible) {
    if (Date.now() - startedAt >= RUN_BUDGET_MS) break;
    try {
      if (!(await purgeAccountDeletion(prisma, req.id))) continue;
      purged += 1;
      details.push({ requestId: req.id, userId: req.userId, ok: true });
    } catch {
      errors += 1;
      details.push({
        requestId: req.id,
        userId: req.userId,
        ok: false,
        error: "deletion_failed_retry_pending",
      });
    }
  }

  return {
    purged,
    errors,
    durationMs: Date.now() - startedAt,
    details,
  };
}

export async function purgeAccountDeletion(
  prisma: PrismaClient,
  requestId: string,
): Promise<boolean> {
  const leaseToken = randomUUID();
  const claimed = await prisma.accountDeletionRequest.updateMany({
    where: { id: requestId, ...eligibleAt(new Date()) },
    data: { status: "in_progress", startedAt: new Date(), leaseToken },
  });
  if (claimed.count !== 1) return false;
  const request = await prisma.accountDeletionRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  const userId = request.userId;
  try {
    const photos = await prisma.profilePhoto.findMany({
      where: { profile: { userId } },
      select: { storageKey: true, cdnUrl: true },
    });
    const verifications = await prisma.verificationRequest.findMany({
      where: { userId, imageStorageKey: { not: null } },
      select: { imageStorageKey: true },
    });
    for (const photo of photos) {
      const result = await deleteProfilePhoto(photo.storageKey, photo.cdnUrl);
      if (!result.ok) throw new Error("photo_delete_failed");
    }
    for (const verification of verifications) {
      const storageKey = verification.imageStorageKey!;
      // Blob del accepts a pathname as well as a URL. Older verification
      // records retain only the pathname; local storage uses the same key.
      const result = await deleteProfilePhoto(storageKey, storageKey);
      if (!result.ok) throw new Error("verification_delete_failed");
    }
    await prisma.$transaction(
      async (tx) => {
        const owned = await tx.accountDeletionRequest.updateMany({
          where: { id: requestId, status: "in_progress", leaseToken },
          data: {
            status: "purged",
            purgedAt: new Date(),
            completedAt: new Date(),
            leaseToken: null,
            reason: null,
            contactEmailHash: null,
          },
        });
        if (owned.count !== 1) throw new Error("deletion_lease_lost");
        // Anonymise the User row. We KEEP the row (referential integrity
        // for surviving matches + message tombstones) but clear every
        // identifier. `displayName` lives on the Profile, so the Profile
        // update below does the rest.
        await tx.user.update({
          where: { id: userId },
          data: {
            emailHash: null,
            phoneHash: null,
            authSubject: null,
            status: "deleted",
            deletedAt: new Date(),
            dateOfBirth: new Date("1970-01-01T00:00:00.000Z"),
            isAgeVerified: false,
          },
        });

        // Anonymise the Profile if it exists. Clear free-text fields,
        // location, and the precise PostGIS column. The location column is
        // Unsupported() in Prisma so it needs raw SQL. We re-read the
        // profile id inside the txn (the outer lookup was for blob cleanup)
        // so this scope reads the same snapshot the updates write into.
        const profile = await tx.profile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (profile) {
          await tx.profile.update({
            where: { userId },
            data: {
              displayName: PLACEHOLDER_DISPLAY_NAME,
              bio: "",
              pronouns: null,
              city: null,
              region: null,
              country: null,
              heightCm: null,
              educationLevel: null,
              college: null,
              jobTitle: null,
              company: null,
              relationshipGoal: null,
              childrenStatus: null,
              familyPlans: null,
              drinking: null,
              smoking: null,
              cannabis: null,
              exercise: null,
              diet: null,
              religion: null,
              politics: null,
              languages: [],
              interests: [],
              prompts: Prisma.DbNull,
              values: [],
              gender: "PreferNotToSay",
              isPhotoVerified: false,
              verificationStatus: "unverified",
              visibilityStatus: "hidden",
            },
          });
          await tx.$executeRawUnsafe(
            `UPDATE "Profile" SET "location" = NULL WHERE "userId" = $1`,
            userId,
          );
          // Photos: hard-delete the DB rows. The underlying blobs were
          // already `del()`-ed above the transaction (see step 1).
          await tx.profilePhoto.deleteMany({ where: { profileId: profile.id } });
        }

        // Hard-delete the user's auth + session state. Sessions cascade on
        // User delete but we're keeping the user, so explicit.
        await tx.session.deleteMany({ where: { userId } });
        await tx.authChallenge.deleteMany({ where: { userId } });
        await tx.deviceToken.deleteMany({ where: { userId } });
        await tx.notificationDevice.deleteMany({ where: { userId } });

        // The user's swipes and likes (both directions) — removing these
        // is required to take the user out of every other user's history
        // and to keep the matching pipeline from re-surfacing a deleted
        // profile. Blocks stay (safety: the OTHER user may have blocked
        // them and that block must survive).
        await tx.swipeAction.deleteMany({
          where: { OR: [{ viewerUserId: userId }, { targetUserId: userId }] },
        });
        await tx.like.deleteMany({
          where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
        });

        // Beta-launch tables — pure first-party data with no surviving party.
        await tx.analyticsEvent.deleteMany({ where: { userId } });
        await tx.betaFeedback.deleteMany({ where: { userId } });

        await tx.preferences.deleteMany({ where: { userId } });
        await tx.notificationPreference.deleteMany({ where: { userId } });
        await tx.verificationRequest.deleteMany({ where: { userId } });
        await tx.deckImpression.deleteMany({
          where: { OR: [{ viewerUserId: userId }, { targetUserId: userId }] },
        });
        await tx.pushDeliveryLog.deleteMany({ where: { userId } });
        await tx.consentRecord.updateMany({
          where: { userId },
          data: { ipHash: null, userAgent: null, withdrawnAt: new Date() },
        });

        // Matches + Messages are RETAINED. The other party in a match
        // should keep seeing the tombstone ("[deleted]") rather than
        // suddenly having their conversation history disappear. The User
        // anonymisation above already removed every identifier; the
        // Profile.displayName="[deleted]" handles the chat header.

        // Write the audit event in the same transaction. A failed audit must
        // not report a completed purge as failed or strand a missing event.
        const systemAdmin = await tx.adminUser.findUnique({
          where: { email: "system@openmatch.local" },
          select: { id: true },
        });
        if (systemAdmin) {
          await tx.adminAuditLog.create({
            data: {
              adminUserId: systemAdmin.id,
              adminRoleSnapshot: "system",
              eventType: "account_purged",
              targetEntityType: "user",
              targetEntityId: userId,
              metadata: { requestId, source: "deletion-worker" },
            },
          });
        }
      },
      { timeout: 30_000 },
    );
    return true;
  } catch (error) {
    // Release only our own lease. If the process dies here, expiry still
    // makes the job eligible again; no manual status repair is necessary.
    await prisma.accountDeletionRequest.updateMany({
      where: { id: requestId, status: "in_progress", leaseToken },
      data: { status: "scheduled", startedAt: null, leaseToken: null },
    });
    throw error;
  }
}
