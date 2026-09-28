import { createHmac, randomUUID } from "node:crypto";
import type {
  ConsentScope,
  DsarChannel,
  DsarRequestType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { env } from "../env.js";
import { hashIp, hashText } from "../lib/hash.js";
import { signPhotoToken } from "../lib/photo-tokens.js";
import { purgeAccountDeletion } from "../workers/deletion.js";

// SEV-M9 — Pseudonymise a peer user id for inclusion in the requester's
// DSAR bundle. The export is shareable (and increasingly publicly
// posted to "rate-my-matches"-style forums), so revealing other users'
// stable backend ids would re-identify them across separate exports.
// We use an HMAC keyed by the requester's id and JWT secret so:
//   - Two peers always hash to two different pseudonyms (privacy).
//   - The same peer is consistent across a single user's export
//     (utility — the user can see "peer:abc liked then unliked me").
//   - The pseudonyms don't roundtrip back to real ids without the
//     server's key (no enumeration).
function peerPseudonym(requesterUserId: string, peerUserId: string): string {
  const mac = createHmac("sha256", env.JWT_SECRET);
  mac.update(`dsar:peer:${requesterUserId}:${peerUserId}`);
  // 128 bits keeps collisions negligible even in large exports.
  return `peer:${mac.digest("hex").slice(0, 32)}`;
}

// Privacy / rights-request service.
//
// Encodes the parts of the compliance roadmap that need backend state:
//   - versioned consent records (ConsentRecord + PolicyDocument)
//   - DSAR intake + status tracking (DataSubjectRequest)
//   - account deletion with grace period (AccountDeletionRequest)
//   - notification preferences (NotificationPreference)
//
// Internal fulfilment target, not a jurisdiction-specific legal deadline.
// A fixed 30-day window can exceed one calendar month in February. Use
// 28 days as the conservative operational target; legal extensions and
// applicability still require a documented operator decision.
const DSAR_TARGET_DAYS = 28;
const DELETION_GRACE_HOURS = 24;

function dueAtFor(): Date {
  return new Date(Date.now() + DSAR_TARGET_DAYS * 24 * 3600 * 1000);
}

// Re-export under the historic name so existing callers keep compiling.
export const textHash = hashText;

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
  const document = await prisma.policyDocument.upsert({
    where: { scope_version: { scope: args.scope, version: args.version } },
    create: {
      scope: args.scope,
      version: args.version,
      textHash: textHash(args.text),
      effectiveAt: args.effectiveAt,
      notes: args.notes ?? null,
    },
    update: {},
  });
  if (
    document.textHash !== textHash(args.text) ||
    document.effectiveAt.getTime() !== args.effectiveAt.getTime()
  ) {
    throw Object.assign(new Error("policy_version_conflict"), { statusCode: 409 });
  }
  return document;
}

export async function getEffectivePolicy(
  prisma: PrismaClient | Prisma.TransactionClient,
  scope: ConsentScope,
) {
  return prisma.policyDocument.findFirst({
    where: { scope, effectiveAt: { lte: new Date() } },
    orderBy: { effectiveAt: "desc" },
  });
}

export class PolicyDocumentMissingError extends Error {
  statusCode = 503;
  constructor(public scope: ConsentScope) {
    super(`no_effective_policy_document_for_scope:${scope}`);
    this.name = "PolicyDocumentMissingError";
  }
}

export async function recordConsent(
  prisma: PrismaClient | Prisma.TransactionClient,
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
  // Every ConsentRecord must pin a concrete (policyVersion, textHash)
  // for the row to be evidentially useful. If the caller didn't pass
  // one we snapshot the currently-effective PolicyDocument. If no doc
  // exists, refuse: a silent "unversioned" consent is worse than no
  // consent at all because it gives false comfort under audit.
  let policyVersion = args.policyVersion;
  let hash = args.textHash;
  let policyDocumentId: string | null = null;
  if (!policyVersion || !hash) {
    const doc = await getEffectivePolicy(prisma, args.scope);
    if (!doc) {
      throw new PolicyDocumentMissingError(args.scope);
    }
    policyVersion = doc.version;
    hash = doc.textHash;
    policyDocumentId = doc.id;
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
  return prisma.$transaction(async (tx) => {
    await tx.consentRecord.updateMany({
      where: { userId: args.userId, scope: args.scope, granted: true, withdrawnAt: null },
      data: { withdrawnAt: new Date() },
    });
    return recordConsent(tx, { ...args, granted: false });
  });
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
  const dueAt = dueAtFor();
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
  // SEV-M9 — see swipesSummary below; raw target user-id list omitted.
  swipesSummary: Record<string, unknown>;
  // SEV-M9 — peer user ids are replaced with per-requester pseudonyms
  // (`peer:abcd1234`). The pseudonyms are stable within a single user's
  // export so the user can correlate "peer:abc liked me and we matched"
  // across collections, but two different requesters' exports do not
  // share pseudonyms — no cross-bundle re-identification of any peer.
  likesSent: Array<Record<string, unknown>>;
  likesReceived: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  // Messages the user sent.
  messagesSent: Array<Record<string, unknown>>;
  // SEV-M9 — Peers' message bodies are NOT included. The authoring
  // peer never consented to having their private DM bundled into a
  // portable, downloadable JSON. We include only message metadata
  // (id, conversation id, timestamp, length) so the requester can
  // reconcile the volume of incoming chat without re-distributing the
  // peer's words. The peer's pseudonymous id is included so the
  // requester can see "peer:abc sent 4 messages on 2026-05-10".
  messagesReceivedSummary: Array<Record<string, unknown>>;
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
        company: profile.company,
        companyDisplayEnabled: profile.companyDisplayEnabled,
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
        values: profile.values,
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
      // Export links use the revocable, short-lived photo proxy too.
      cdnUrl: `/api/v1/photos/${encodeURIComponent(p.id)}/serve?token=${encodeURIComponent(signPhotoToken({ photoId: p.id, audienceUserId: userId }))}&aud=${encodeURIComponent(userId)}`,
      sortOrder: p.sortOrder,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt,
    })) ?? [];

  // The user's conversations — used to scope which received messages
  // we include (we never reveal messages from conversations the user
  // isn't part of).
  const conversationIds = (
    await prisma.conversation.findMany({
      where: {
        match: { OR: [{ userAId: userId }, { userBId: userId }] },
      },
      select: { id: true },
    })
  ).map((c) => c.id);

  // Privacy: actions the user took themselves, plus messages addressed
  // to them in conversations they're part of (Art. 15 personal data
  // concerning the user — what they can already see in chat).
  const [
    swipeGroups,
    likesSent,
    likesReceived,
    matches,
    messagesSent,
    messagesReceivedRaw,
    reportsMade,
    blocks,
    consents,
  ] = await Promise.all([
    prisma.swipeAction.groupBy({
      by: ["decision"],
      where: { viewerUserId: userId },
      _count: { _all: true, undoneAt: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
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
    prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        senderUserId: { not: userId },
        deletedAt: null,
      },
      // SEV-M9 — Intentionally NOT selecting `body`. See ExportBundle
      // comment.
      select: {
        id: true,
        conversationId: true,
        senderUserId: true,
        createdAt: true,
      },
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

  // SEV-M9 — Aggregate swipe history to counts instead of raw
  // (targetUserId, decision) pairs. The raw list lets the holder of
  // the bundle reconstruct everyone the user rejected; the summary is
  // enough to satisfy "I want to know what data you hold about me".
  const swipesSummary = {
    totalSwipes: swipeGroups.reduce((sum, row) => sum + row._count._all, 0),
    likes: swipeGroups.find((row) => row.decision === "like")?._count._all ?? 0,
    rejects: swipeGroups.find((row) => row.decision === "reject")?._count._all ?? 0,
    undone: swipeGroups.reduce((sum, row) => sum + row._count.undoneAt, 0),
    firstSwipeAt: swipeGroups.length
      ? new Date(Math.min(...swipeGroups.map((row) => row._min.createdAt!.getTime())))
      : null,
    lastSwipeAt: swipeGroups.length
      ? new Date(Math.max(...swipeGroups.map((row) => row._max.createdAt!.getTime())))
      : null,
    note:
      "Per-swipe target user ids were omitted to protect other users' privacy. " +
      "If you need the raw per-swipe history, file a portability DSAR at " +
      "/privacy/dsar with requestType=portability — fulfilment includes a " +
      "manual review for peer re-identification risk.",
  };

  // SEV-M9 — Pseudonymise every peer id touched by the bundle.
  const likesSentRedacted = likesSent.map((l) => ({
    id: l.id,
    peer: peerPseudonym(userId, l.toUserId),
    status: l.status,
    createdAt: l.createdAt,
    withdrawnAt: l.withdrawnAt,
  }));
  const likesReceivedRedacted = likesReceived.map((l) => ({
    id: l.id,
    peer: peerPseudonym(userId, l.fromUserId),
    status: l.status,
    createdAt: l.createdAt,
  }));
  const matchesRedacted = matches.map((m) => {
    const peerId = m.userAId === userId ? m.userBId : m.userAId;
    return {
      id: m.id,
      peer: peerPseudonym(userId, peerId),
      createdAt: m.createdAt,
    };
  });
  const messagesReceivedSummary = messagesReceivedRaw.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    sender: peerPseudonym(userId, m.senderUserId),
    createdAt: m.createdAt,
  }));
  const blocksRedacted = blocks.map((b) => ({
    id: b.id,
    peer: peerPseudonym(userId, b.blockedUserId),
    createdAt: b.createdAt,
  }));
  const reportsRedacted = reportsMade.map((r) => ({
    id: r.id,
    peer: peerPseudonym(userId, r.reportedUserId),
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolution: r.resolution,
  }));

  return {
    schemaVersion: "openmatch.export.v2",
    generatedAt: new Date().toISOString(),
    user,
    profile: profileView,
    preferences,
    notificationPreferences,
    photos,
    swipesSummary,
    likesSent: likesSentRedacted,
    likesReceived: likesReceivedRedacted,
    matches: matchesRedacted,
    messagesSent,
    messagesReceivedSummary,
    reportsMade: reportsRedacted,
    blocksMade: blocksRedacted,
    consents,
  };
}

// -------- Account deletion --------

export async function scheduleAccountDeletion(
  prisma: PrismaClient,
  args: { userId: string; reason?: string; contactEmailHash?: string | null },
) {
  // Serialize lifecycle changes on the user row. All local shutdown writes
  // commit with the request: a failed revoke must never report success.
  const request = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${args.userId} FOR UPDATE`;
    const existing = await tx.accountDeletionRequest.findFirst({
      where: { userId: args.userId, status: { in: ["scheduled", "in_progress"] } },
    });
    if (existing) return existing;
    const user = await tx.user.findUniqueOrThrow({ where: { id: args.userId } });
    if (user.status === "deleted") {
      throw Object.assign(new Error("account_inactive"), { statusCode: 409 });
    }
    const now = new Date();
    const created = await tx.accountDeletionRequest.create({
      data: {
        userId: args.userId,
        gracePeriodEndsAt: new Date(now.getTime() + DELETION_GRACE_HOURS * 3600 * 1000),
        reason: args.reason ?? null,
        contactEmailHash: args.contactEmailHash ?? null,
        retainedDataNote:
          "Conversation and safety records retain a pseudonymous user reference; see the retention policy.",
      },
    });
    // Preserve bans through scheduling and cancellation.
    await tx.user.updateMany({
      where: { id: args.userId, status: { not: "banned" } },
      data: { status: "paused" },
    });
    await tx.profile.updateMany({
      where: { userId: args.userId },
      data: { visibilityStatus: "hidden" },
    });
    await tx.preferences.updateMany({
      where: { userId: args.userId },
      data: { discoveryPaused: true },
    });
    await tx.session.updateMany({
      where: { userId: args.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.deviceToken.deleteMany({ where: { userId: args.userId } });
    await tx.notificationDevice.deleteMany({ where: { userId: args.userId } });
    await tx.match.updateMany({
      where: { OR: [{ userAId: args.userId }, { userBId: args.userId }], status: "active" },
      data: { status: "unmatched", unmatchedAt: now, unmatchedByUserId: args.userId },
    });
    await tx.like.updateMany({
      where: { OR: [{ fromUserId: args.userId }, { toUserId: args.userId }], status: "active" },
      data: { status: "withdrawn", withdrawnAt: now },
    });
    return created;
  });
  // 5. SEV-M10 — Best-effort Ably channel teardown for every active
  //    conversation. Future Ably tokens won't grant subscribe (the
  //    realtime route already scopes on `status: active` and the user
  //    is now paused), but already-issued tokens stay valid until
  //    TTL. The sentinel publish drops cached state on connected peers.
  try {
    const activeConversations = await prisma.conversation.findMany({
      where: {
        match: { OR: [{ userAId: args.userId }, { userBId: args.userId }] },
      },
      select: { id: true },
    });
    if (activeConversations.length > 0) {
      const { ably, conversationChannel } = await import("../lib/realtime.js");
      if (ably) {
        await Promise.all(
          activeConversations.map(async (c) => {
            try {
              await ably.channels.get(conversationChannel(c.id)).publish("conversation.closed", {
                conversationId: c.id,
                reason: "account_deletion_scheduled",
                at: new Date().toISOString(),
              });
            } catch {
              // Best-effort — application-layer auth still rejects new sends.
            }
          }),
        );
      }
    }
  } catch {
    // Conversations may not exist (signup-only account); ignore.
  }
  return request;
}

export async function cancelAccountDeletion(prisma: PrismaClient, userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.accountDeletionRequest.findFirst({
      where: { userId, status: "scheduled" },
    });
    if (!existing) throw Object.assign(new Error("no_scheduled_deletion"), { statusCode: 404 });
    const now = new Date();
    const changed = await tx.accountDeletionRequest.updateMany({
      where: { id: existing.id, status: "scheduled", gracePeriodEndsAt: { gt: now } },
      data: { status: "cancelled", cancelledAt: now },
    });
    if (changed.count !== 1)
      throw Object.assign(new Error("grace_period_expired"), { statusCode: 409 });
    await tx.user.updateMany({
      where: { id: userId, status: "paused", isBanned: false },
      data: { status: "active" },
    });
    // Keep visibility and discovery paused until the user explicitly opts
    // back in. Cancellation must not expose a previously hidden profile.
    return tx.accountDeletionRequest.findUniqueOrThrow({ where: { id: existing.id } });
  });
}

// Compatibility entry point; cron and direct callers share one erasure path.
export async function performAccountErasure(prisma: PrismaClient, userId: string) {
  const request = await prisma.accountDeletionRequest.findFirst({
    where: { userId, status: { in: ["scheduled", "in_progress"] } },
  });
  if (!request) throw Object.assign(new Error("no_scheduled_deletion"), { statusCode: 404 });
  if (request.gracePeriodEndsAt > new Date()) {
    throw Object.assign(new Error("grace_period_not_yet_expired"), { statusCode: 409 });
  }
  if (!(await purgeAccountDeletion(prisma, request.id))) {
    throw Object.assign(new Error("deletion_already_claimed"), { statusCode: 409 });
  }
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
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...DEFAULT_NOTIFICATION_PREFS },
    update: {},
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
  // Track opt-in AND opt-out timestamps independently. The previous
  // logic suppressed opt-out timestamps when an opt-in occurred in the
  // same patch (e.g. enable email, disable push), which dropped the
  // CASL/TCPA-relevant opt-out event. Record whichever events the
  // patch actually contains.
  const now = new Date();
  const hasOptIn =
    patch.productNewsEmail === true ||
    patch.productNewsPush === true ||
    patch.productNewsSms === true;
  const hasOptOut =
    patch.productNewsEmail === false ||
    patch.productNewsPush === false ||
    patch.productNewsSms === false;
  return prisma.notificationPreference.update({
    where: { userId },
    data: {
      ...patch,
      ...(hasOptIn ? { marketingOptInAt: now } : {}),
      ...(hasOptOut ? { marketingOptOutAt: now } : {}),
    },
  });
}

// -------- Diagnostic helpers --------

export function _testRandomId(): string {
  // Re-exported so the route tests can pin a deterministic id when
  // mocking; not part of the public surface.
  return randomUUID();
}
