import type { PrismaClient } from "@prisma/client";
import { deleteProfilePhoto } from "../lib/media.js";
import { requestContext } from "../lib/request-context.js";

// Account-deletion purge worker (COMP-3).
//
// The Privacy-route + service shipped a 24-hour grace window where the
// user can cancel a deletion request. This worker is the second half:
// after the grace window expires, it anonymises the User row and
// hard-deletes everything that can be safely removed (sessions, swipes,
// likes, push tokens, beta feedback, analytics events). Matches and
// authored Messages are retained as tombstones so the *other* side of
// the conversation isn't silently corrupted.
//
// Invoked from POST /api/v1/internal/run-deletion-purge — gated by the
// INTERNAL_WORKER_TOKEN bearer, and wired to a Vercel cron at
// `*/15 * * * *` in vercel.json.

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
    where: {
      status: "scheduled",
      cancelledAt: null,
      gracePeriodEndsAt: { lt: now },
    },
    orderBy: { gracePeriodEndsAt: "asc" },
    take: 100,
  });

  const details: DeletionPurgeReport["details"] = [];
  let purged = 0;
  let errors = 0;

  for (const req of eligible) {
    try {
      await purgeOne(prisma, req.id, req.userId);
      purged += 1;
      details.push({ requestId: req.id, userId: req.userId, ok: true });
    } catch (err) {
      errors += 1;
      details.push({
        requestId: req.id,
        userId: req.userId,
        ok: false,
        error: (err as Error).message,
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

// Single-row purge wrapped in a transaction so a mid-flight failure
// can't leave a half-anonymised user behind. Order matters only loosely
// because nearly every dependent table cascades on User delete and we
// retain the User row — but explicit deletes are clearer than relying
// on cascade for the cases where we KEEP something (Match, Message).
async function purgeOne(prisma: PrismaClient, requestId: string, userId: string): Promise<void> {
  // Step 1 (outside the txn): collect every blob this user's photos
  // refer to and call `del()` on each one. Done BEFORE the txn drops
  // the rows so a failed blob delete doesn't strand an orphan record.
  // SEV-N16/M7: this is the "actually CDN-cleanup" half the audit
  // flagged as missing. We tolerate per-blob failures but record the
  // count so the system_admin audit row can capture them.
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  let blobDeleteFailures = 0;
  if (profile) {
    const photos = await prisma.profilePhoto.findMany({
      where: { profileId: profile.id },
      select: { id: true, storageKey: true, cdnUrl: true },
    });
    for (const photo of photos) {
      const result = await deleteProfilePhoto(photo.storageKey, photo.cdnUrl);
      if (!result.ok) blobDeleteFailures += 1;
    }
  }

  await prisma.$transaction(async (tx) => {
    // Mark the request as in_progress first so a concurrent worker
    // can't pick it up. The unique([userId, status]) constraint on
    // AccountDeletionRequest means moving status off "scheduled" is
    // the lock.
    await tx.accountDeletionRequest.update({
      where: { id: requestId },
      data: { status: "in_progress", startedAt: new Date() },
    });

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
        isBanned: false,
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
          prompts: undefined,
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

    // Matches + Messages are RETAINED. The other party in a match
    // should keep seeing the tombstone ("[deleted]") rather than
    // suddenly having their conversation history disappear. The User
    // anonymisation above already removed every identifier; the
    // Profile.displayName="[deleted]" handles the chat header.

    // Finalise the deletion request.
    await tx.accountDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: "purged",
        purgedAt: new Date(),
        completedAt: new Date(),
      },
    });
  });

  // Audit row outside the transaction — admin audit writes use the
  // top-level client and have their own retention. Marking event type
  // `account_purged`. Because this is a system-driven (not human-admin)
  // action we DON'T have an adminUserId; we use the special "system"
  // admin user if it exists, otherwise we skip the audit row to avoid
  // breaking the FK. The seed in backend/prisma/seed-admin.ts creates
  // the system user.
  const systemAdmin = await prisma.adminUser.findUnique({
    where: { email: "system@openmatch.local" },
    select: { id: true },
  });
  if (systemAdmin) {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: systemAdmin.id,
        adminRoleSnapshot: "system",
        eventType: "account_purged",
        targetEntityType: "user",
        targetEntityId: userId,
        metadata: {
          requestId,
          source: "deletion-worker",
          blobDeleteFailures,
        },
      },
    });
  }
}
