import { createHash, randomUUID } from "node:crypto";
import type { ConsentScope, DsarChannel, DsarRequestType, PrismaClient } from "@prisma/client";

// Privacy / rights-request service.
//
// Encodes the parts of the compliance roadmap that need backend state:
//   - versioned consent records (ConsentRecord + PolicyDocument)
//   - DSAR intake + status tracking (DataSubjectRequest)
//   - account deletion with grace period (AccountDeletionRequest)
//   - notification preferences (NotificationPreference)
//
// Statutory time limits used as defaults:
//   - GDPR Art. 12(3):    30 days for rights requests (extendable to 90)
//   - CCPA §1798.130:     45 days (extendable to 90)
//   - Account deletion:   24-hour grace period before async erasure runs
//
// See docs/legal/privacy-notice.md and docs/legal/compliance-roadmap.md.

const DSAR_GDPR_DUE_DAYS = 30;
const DSAR_CCPA_DUE_DAYS = 45;
const DELETION_GRACE_HOURS = 24;

const CCPA_JURISDICTIONS = new Set(["US", "CA"]);

function dueAtFor(requestType: DsarRequestType, jurisdiction?: string | null): Date {
  // Use the *shorter* of the applicable windows so we never miss a deadline.
  const days =
    jurisdiction && CCPA_JURISDICTIONS.has(jurisdiction.toUpperCase())
      ? Math.min(DSAR_GDPR_DUE_DAYS, DSAR_CCPA_DUE_DAYS)
      : DSAR_GDPR_DUE_DAYS;
  // CCPA "right to delete" specifically tracks 45d; otherwise use 30d as a
  // conservative single horizon.
  void requestType;
  return new Date(Date.now() + days * 24 * 3600 * 1000);
}

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function hashIp(ip?: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// -------- Policy documents + consent --------

export async function publishPolicyDocument(
  prisma: PrismaClient,
  args: {
    scope: ConsentScope;
    version: string;
    text: string;
    effectiveAt: Date;
    notes?: string;
  },
) {
  return prisma.policyDocument.upsert({
    where: { scope_version: { scope: args.scope, version: args.version } },
    create: {
      scope: args.scope,
      version: args.version,
      textHash: textHash(args.text),
      effectiveAt: args.effectiveAt,
      notes: args.notes ?? null,
    },
    update: {
      textHash: textHash(args.text),
      effectiveAt: args.effectiveAt,
      notes: args.notes ?? null,
    },
  });
}

export async function getEffectivePolicy(prisma: PrismaClient, scope: ConsentScope) {
  return prisma.policyDocument.findFirst({
    where: { scope, effectiveAt: { lte: new Date() } },
    orderBy: { effectiveAt: "desc" },
  });
}

export async function recordConsent(
  prisma: PrismaClient,
  args: {
    userId: string;
    scope: ConsentScope;
    granted: boolean;
    surface: string;
    ip?: string | null;
    userAgent?: string | null;
    policyVersion?: string;
    textHash?: string;
  },
) {
  // If caller didn't pass an explicit policy version, snapshot the
  // currently-effective policy. This means a consent record always pins
  // a concrete (version, text_hash) — which is what makes it provable.
  let policyVersion = args.policyVersion;
  let hash = args.textHash;
  let policyDocumentId: string | null = null;
  if (!policyVersion || !hash) {
    const doc = await getEffectivePolicy(prisma, args.scope);
    if (doc) {
      policyVersion = doc.version;
      hash = doc.textHash;
      policyDocumentId = doc.id;
    } else {
      // No policy doc exists yet — record an unversioned consent. CI
      // should flag this; production should not reach it.
      policyVersion = policyVersion ?? "unversioned";
      hash = hash ?? "unversioned";
    }
  }

  return prisma.consentRecord.create({
    data: {
      userId: args.userId,
      scope: args.scope,
      policyDocumentId,
      granted: args.granted,
      policyVersion,
      textHash: hash,
      ipHash: hashIp(args.ip),
      userAgent: args.userAgent ?? null,
      surface: args.surface,
    },
  });
}

export async function withdrawConsent(
  prisma: PrismaClient,
  args: { userId: string; scope: ConsentScope; ip?: string; userAgent?: string; surface: string },
) {
  // Mark prior grants as withdrawn AND record an explicit withdrawal
  // event. Both are needed: the prior grant remains as historical
  // evidence (we cannot pretend it never happened), while the withdrawal
  // is the operative signal for future processing decisions.
  await prisma.consentRecord.updateMany({
    where: { userId: args.userId, scope: args.scope, granted: true, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });
  return recordConsent(prisma, { ...args, granted: false });
}

export async function listEffectiveConsents(prisma: PrismaClient, userId: string) {
  const records = await prisma.consentRecord.findMany({
    where: { userId },
    orderBy: { collectedAt: "desc" },
  });
  // Reduce to the latest non-withdrawn record per scope.
  const out = new Map<ConsentScope, (typeof records)[number]>();
  for (const r of records) {
    if (out.has(r.scope)) continue;
    out.set(r.scope, r);
  }
  return Array.from(out.values()).map((r) => ({
    scope: r.scope,
    granted: r.granted && !r.withdrawnAt,
    policyVersion: r.policyVersion,
    collectedAt: r.collectedAt,
    withdrawnAt: r.withdrawnAt,
  }));
}

// -------- DSAR intake --------

export async function openDsar(
  prisma: PrismaClient,
  args: {
    userId?: string | null;
    requestType: DsarRequestType;
    channel: DsarChannel;
    jurisdiction?: string;
    contactEmail?: string;
    notes?: string;
  },
) {
  const dueAt = dueAtFor(args.requestType, args.jurisdiction);
  return prisma.dataSubjectRequest.create({
    data: {
      userId: args.userId ?? null,
      requestType: args.requestType,
      channel: args.channel,
      jurisdiction: args.jurisdiction ?? null,
      contactEmail: args.contactEmail ?? null,
      notes: args.notes ?? null,
      dueAt,
    },
  });
}

export async function listMyDsars(prisma: PrismaClient, userId: string) {
  return prisma.dataSubjectRequest.findMany({
    where: { userId },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      requestType: true,
      status: true,
      receivedAt: true,
      dueAt: true,
      fulfilledAt: true,
      exportFormat: true,
    },
  });
}

// -------- Access / portability export bundle --------

export interface ExportBundle {
  schemaVersion: string;
  generatedAt: string;
  user: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  preferences: Record<string, unknown> | null;
  notificationPreferences: Record<string, unknown> | null;
  photos: Array<Record<string, unknown>>;
  swipes: Array<Record<string, unknown>>;
  likesSent: Array<Record<string, unknown>>;
  likesReceived: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  reportsMade: Array<Record<string, unknown>>;
  blocksMade: Array<Record<string, unknown>>;
  consents: Array<Record<string, unknown>>;
}

// Build the GDPR/CCPA-style "machine readable" bundle. Photos are
// included as URLs, not bytes — the export is the metadata index, and
// the iOS client follows links to download. This keeps the API response
// bounded.
//
// Privacy invariants enforced here:
//   - Exact lat/long is NEVER included; only the city/region the user
//     already shows others.
//   - We never include other users' private fields. Matches/messages
//     include the *other party's* display data only at the level the
//     requester already legitimately sees.
//   - Internal moderation signals, sensitive access grants, and IP
//     hashes are excluded.
export async function buildExportBundle(
  prisma: PrismaClient,
  userId: string,
): Promise<ExportBundle> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      dateOfBirth: true,
      authProvider: true,
      isAgeVerified: true,
    },
  });
  if (!user) throw Object.assign(new Error("user_not_found"), { statusCode: 404 });

  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
  });

  // Explicitly project; never pass the raw `location` PostGIS column.
  const profileView = profile
    ? {
        id: profile.id,
        displayName: profile.displayName,
        bio: profile.bio,
        gender: profile.gender,
        pronouns: profile.pronouns,
        city: profile.city,
        region: profile.region,
        country: profile.country,
        heightCm: profile.heightCm,
        educationLevel: profile.educationLevel,
        college: profile.college,
        jobTitle: profile.jobTitle,
        company: profile.companyDisplayEnabled ? profile.company : null,
        relationshipGoal: profile.relationshipGoal,
        childrenStatus: profile.childrenStatus,
        familyPlans: profile.familyPlans,
        drinking: profile.drinking,
        smoking: profile.smoking,
        cannabis: profile.cannabis,
        exercise: profile.exercise,
        diet: profile.diet,
        religion: profile.religion,
        politics: profile.politics,
        languages: profile.languages,
        interests: profile.interests,
        visibilityStatus: profile.visibilityStatus,
        verificationStatus: profile.verificationStatus,
        prompts: profile.prompts,
        lastActiveAt: profile.lastActiveAt,
      }
    : null;

  const preferences = await prisma.preferences.findUnique({ where: { userId } });
  const notificationPreferences = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  const photos =
    profile?.photos.map((p) => ({
      id: p.id,
      cdnUrl: p.cdnUrl,
      sortOrder: p.sortOrder,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt,
    })) ?? [];

  // Privacy: only the *actions the user took themselves*, never the
  // visibility of who saw them — see privacy principles §4.
  const [swipesMade, likesSent, likesReceived, matches, messages, reportsMade, blocks, consents] =
    await Promise.all([
      prisma.swipeAction.findMany({
        where: { viewerUserId: userId },
        select: {
          id: true,
          targetUserId: true,
          decision: true,
          algorithmVersion: true,
          createdAt: true,
          undoneAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.like.findMany({
        where: { fromUserId: userId },
        select: { id: true, toUserId: true, status: true, createdAt: true, withdrawnAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.like.findMany({
        where: { toUserId: userId, status: { in: ["active", "matched"] } },
        select: { id: true, fromUserId: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.match.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }], status: "active" },
        select: { id: true, userAId: true, userBId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.message.findMany({
        where: { senderUserId: userId },
        select: { id: true, conversationId: true, body: true, createdAt: true, deletedAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.report.findMany({
        where: { reporterUserId: userId },
        select: {
          id: true,
          reportedUserId: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
          resolution: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.block.findMany({
        where: { blockerUserId: userId },
        select: { id: true, blockedUserId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.consentRecord.findMany({
        where: { userId },
        select: {
          id: true,
          scope: true,
          granted: true,
          policyVersion: true,
          collectedAt: true,
          withdrawnAt: true,
          surface: true,
        },
        orderBy: { collectedAt: "desc" },
      }),
    ]);

  return {
    schemaVersion: "openmatch.export.v1",
    generatedAt: new Date().toISOString(),
    user,
    profile: profileView,
    preferences,
    notificationPreferences,
    photos,
    swipes: swipesMade,
    likesSent,
    likesReceived,
    matches,
    messages,
    reportsMade,
    blocksMade: blocks,
    consents,
  };
}

// -------- Account deletion --------

export async function scheduleAccountDeletion(
  prisma: PrismaClient,
  args: { userId: string; reason?: string; contactEmailHash?: string | null },
) {
  // Idempotent. If a scheduled deletion exists, return it.
  const existing = await prisma.accountDeletionRequest.findFirst({
    where: { userId: args.userId, status: "scheduled" },
  });
  if (existing) return existing;

  const gracePeriodEndsAt = new Date(Date.now() + DELETION_GRACE_HOURS * 3600 * 1000);
  const request = await prisma.accountDeletionRequest.create({
    data: {
      userId: args.userId,
      gracePeriodEndsAt,
      reason: args.reason ?? null,
      contactEmailHash: args.contactEmailHash ?? null,
      retainedDataNote:
        "Hashed identifiers retained for ban-evasion and legal-compliance per Privacy Notice §2.",
    },
  });
  // Immediately hide from discovery — even before the worker runs.
  await prisma.profile
    .update({
      where: { userId: args.userId },
      data: { visibilityStatus: "hidden" },
    })
    .catch(() => {
      // Profile may not yet exist (signup not finished); ignore.
    });
  await prisma.preferences
    .update({ where: { userId: args.userId }, data: { discoveryPaused: true } })
    .catch(() => undefined);
  return request;
}

export async function cancelAccountDeletion(prisma: PrismaClient, userId: string) {
  const existing = await prisma.accountDeletionRequest.findFirst({
    where: { userId, status: "scheduled" },
  });
  if (!existing) {
    throw Object.assign(new Error("no_scheduled_deletion"), { statusCode: 404 });
  }
  if (existing.gracePeriodEndsAt < new Date()) {
    throw Object.assign(new Error("grace_period_expired"), { statusCode: 409 });
  }
  const updated = await prisma.accountDeletionRequest.update({
    where: { id: existing.id },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
  await prisma.profile
    .update({ where: { userId }, data: { visibilityStatus: "visible" } })
    .catch(() => undefined);
  return updated;
}

// Async erasure worker entrypoint. Splits the work into "delete what
// can be deleted" and "anonymise what must be retained for legal /
// safety / fraud reasons". The retained side is a strict allow-list.
export async function performAccountErasure(prisma: PrismaClient, userId: string) {
  const request = await prisma.accountDeletionRequest.findFirst({
    where: { userId, status: "scheduled" },
  });
  if (!request) {
    throw Object.assign(new Error("no_scheduled_deletion"), { statusCode: 404 });
  }
  if (request.gracePeriodEndsAt > new Date()) {
    throw Object.assign(new Error("grace_period_not_yet_expired"), { statusCode: 409 });
  }
  await prisma.accountDeletionRequest.update({
    where: { id: request.id },
    data: { status: "in_progress", startedAt: new Date() },
  });

  await prisma.$transaction(async (tx) => {
    // Anonymise profile (Cascade would delete it; we want a tombstone
    // for surviving conversation parties).
    await tx.profile.update({
      where: { userId },
      data: {
        displayName: "Deleted user",
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
    // Delete photos (CDN cleanup is the caller's responsibility — it
    // requires Vercel Blob access not available in a tx).
    await tx.profilePhoto.deleteMany({ where: { profile: { userId } } });
    // Delete sessions, tokens, challenges.
    await tx.session.deleteMany({ where: { userId } });
    await tx.authChallenge.deleteMany({ where: { userId } });
    await tx.deviceToken.deleteMany({ where: { userId } });
    // Mark the user record itself as deleted. We do NOT physically
    // delete it — bans, ban-evasion signals, and unfinished moderation
    // require a stable tombstone id.
    await tx.user.update({
      where: { id: userId },
      data: {
        status: "deleted",
        deletedAt: new Date(),
        // Hashes can be retained for ban-evasion detection but the raw
        // values are already only stored hashed today.
      },
    });
    await tx.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: "completed", completedAt: new Date() },
    });
  });

  return { ok: true, requestId: request.id };
}

// -------- Notification preferences --------

export type PushPreviewMode = "full" | "sender_only" | "hidden";

export interface NotificationPrefsPatch {
  productNewsEmail: boolean;
  productNewsPush: boolean;
  productNewsSms: boolean;
  newMatchPush: boolean;
  newMessagePush: boolean;
  newLikePush: boolean;
  safetyPush: boolean;
  pushPreviewMode: PushPreviewMode;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsPatch = {
  productNewsEmail: false,
  productNewsPush: false,
  productNewsSms: false,
  newMatchPush: true,
  newMessagePush: true,
  newLikePush: true,
  safetyPush: true,
  pushPreviewMode: "sender_only",
};

export async function getNotificationPreferences(prisma: PrismaClient, userId: string) {
  const existing = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.notificationPreference.create({
    data: { userId, ...DEFAULT_NOTIFICATION_PREFS },
  });
}

export async function updateNotificationPreferences(
  prisma: PrismaClient,
  userId: string,
  patch: Partial<NotificationPrefsPatch> & {
    marketingOptInSource?: string;
  },
) {
  await getNotificationPreferences(prisma, userId);
  const marketingOptInNow =
    patch.productNewsEmail === true ||
    patch.productNewsPush === true ||
    patch.productNewsSms === true;
  const marketingOptOutNow =
    patch.productNewsEmail === false ||
    patch.productNewsPush === false ||
    patch.productNewsSms === false;
  return prisma.notificationPreference.update({
    where: { userId },
    data: {
      ...patch,
      ...(marketingOptInNow ? { marketingOptInAt: new Date() } : {}),
      ...(marketingOptOutNow && !marketingOptInNow ? { marketingOptOutAt: new Date() } : {}),
    },
  });
}

// -------- Diagnostic helpers --------

export function _testRandomId(): string {
  // Re-exported so the route tests can pin a deterministic id when
  // mocking; not part of the public surface.
  return randomUUID();
}
