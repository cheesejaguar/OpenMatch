import type {
  ActivityBucket,
  Candidate,
  Gender as MatchingGender,
  Profile as MatchingProfile,
  RelationshipGoal as MatchingRelationshipGoal,
  RankingProvider,
  Viewer,
} from "@openmatch/matching";
import {
  currentConfig,
  defaultRankingProvider,
  getDiscoveryDeck,
  resolveConfig,
} from "@openmatch/matching";
import type { PrismaClient } from "@prisma/client";
import { env } from "../env.js";
import { ageOnDate } from "../lib/age.js";
import { haversineKm } from "../lib/location.js";
import { getPresetCatalog, resolveActivePresetKey } from "../lib/matching-presets.js";
import { getActiveMetros } from "../lib/metros-cache.js";
import { withSpan } from "../lib/spans.js";

// DISC-Q1 — anti-staleness window. Candidates seen on a deck in the
// last 7 days are filtered out of subsequent decks unless the candidate
// pool is so thin that we'd otherwise return nothing — in which case
// stale-but-unswiped candidates flow back through at a deprioritised
// rank (see how `recentImpressions` is hydrated below).
const IMPRESSION_STALENESS_WINDOW_DAYS = 7;

// DISC-Q3 — RankingProvider override. Resolved once and reused. The deck
// ranks via the viewer's selected preset strategy by default; setting
// `OPENMATCH_RANKING_PROVIDER` lets forks/ops force an explicit provider
// (builtin / engagement / learned) that overrides the preset strategy. When
// the env var is unset we return undefined so the preset strategy wins.
let providerResolved = false;
let cachedProvider: RankingProvider | undefined;
function getRankingProvider(): RankingProvider | undefined {
  if (!providerResolved) {
    const override =
      typeof process !== "undefined" ? process.env.OPENMATCH_RANKING_PROVIDER : undefined;
    cachedProvider = override ? defaultRankingProvider() : undefined;
    providerResolved = true;
  }
  return cachedProvider;
}

/**
 * Test-only hook to reset the cached provider so unit tests can flip
 * `process.env.OPENMATCH_RANKING_PROVIDER` between cases. Not exported
 * from the package boundary.
 */
export function __resetRankingProviderCache() {
  providerResolved = false;
  cachedProvider = undefined;
}

const ACTIVITY_BUCKETS: Array<{ maxHours: number; bucket: ActivityBucket }> = [
  { maxHours: 24, bucket: "within24h" },
  { maxHours: 24 * 7, bucket: "within7d" },
  { maxHours: 24 * 30, bucket: "within30d" },
];

function activityBucket(lastActiveAt: Date, now: Date): ActivityBucket {
  const hours = (now.getTime() - lastActiveAt.getTime()) / 3_600_000;
  for (const b of ACTIVITY_BUCKETS) {
    if (hours <= b.maxHours) return b.bucket;
  }
  return "older";
}

interface RawProfileRow {
  profile_id: string;
  user_id: string;
  display_name: string;
  bio: string;
  gender: string;
  city: string | null;
  height_cm: number | null;
  education_level: string | null;
  relationship_goal: string | null;
  interests: string[];
  values: string[];
  is_photo_verified: boolean;
  account_status: string;
  visibility_status: string;
  moderation_status: string;
  last_active_at: Date;
  lat: number;
  lng: number;
  prefs_min_age: number;
  prefs_max_age: number;
  prefs_interested_genders: string[];
  has_at_least_two_photos: boolean;
  has_at_least_one_prompt: boolean;
}

function toMatchingProfile(row: RawProfileRow): MatchingProfile {
  return {
    id: row.profile_id,
    userId: row.user_id,
    displayName: row.display_name,
    age: 0, // computed below
    gender: row.gender as MatchingGender,
    location: { lat: row.lat, lng: row.lng },
    city: row.city,
    relationshipGoal:
      row.relationship_goal === null ? null : (row.relationship_goal as MatchingRelationshipGoal),
    interests: row.interests,
    values: row.values ?? [],
    accountStatus: row.account_status as MatchingProfile["accountStatus"],
    visibilityStatus: row.visibility_status as MatchingProfile["visibilityStatus"],
    moderationStatus: row.moderation_status as MatchingProfile["moderationStatus"],
    lastActiveAt: row.last_active_at,
    publicFields: {
      hasPhotosAtLeastTwo: row.has_at_least_two_photos,
      hasDisplayName: Boolean(row.display_name),
      hasAge: true,
      hasGender: true,
      hasBioAtLeast30Chars: row.bio.length >= 30,
      hasAtLeastOnePrompt: row.has_at_least_one_prompt,
      hasAtLeastThreeInterests: row.interests.length >= 3,
      hasRelationshipGoal: row.relationship_goal !== null,
      hasEducationLevel: row.education_level !== null,
      hasCity: row.city !== null,
    },
    interestedInGenders: row.prefs_interested_genders as MatchingGender[],
    candidatePreferredAgeRange: [row.prefs_min_age, row.prefs_max_age],
  };
}

export interface BuildDeckInput {
  prisma: PrismaClient;
  viewerUserId: string;
  limit: number;
  deckSessionId: string;
  now?: Date;
}

export async function buildDeck(input: BuildDeckInput) {
  return withSpan("discovery.buildDeck", "discovery.buildDeck", () => buildDeckInner(input));
}

async function buildDeckInner(input: BuildDeckInput) {
  const now = input.now ?? new Date();
  const viewerUser = await input.prisma.user.findUnique({
    where: { id: input.viewerUserId },
    include: { profile: true, preferences: true },
  });
  if (!viewerUser || !viewerUser.profile || !viewerUser.preferences) {
    throw Object.assign(new Error("viewer_not_initialized"), { statusCode: 400 });
  }

  // Pull viewer location.
  const viewerLoc = await input.prisma.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
    `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM "Profile" WHERE "userId" = $1`,
    input.viewerUserId,
  );
  if (!viewerLoc[0] || viewerLoc[0].lat === null || viewerLoc[0].lng === null) {
    throw Object.assign(new Error("viewer_has_no_location"), { statusCode: 400 });
  }

  const maxDistanceKm = viewerUser.preferences.maxDistanceKm;
  const viewerLat = viewerLoc[0].lat;
  const viewerLng = viewerLoc[0].lng;

  // Metro overlay (BETA-2). If the viewer's location sits inside an
  // active MetroBoundary, we additionally require each candidate to
  // sit inside that same boundary. The candidate radius-from-viewer
  // filter still applies, but the metro filter prevents (e.g.) someone
  // setting their preference radius wide enough to leak into an
  // adjacent metro. If the viewer is in no metro, we fall back to
  // the preference-radius filter only.
  // PERF-B12 — process-local LRU keyed by country (or all-active for
  // unknown viewer-country). MetroBoundary changes ~quarterly so even a
  // 30s TTL eliminates >95% of round-trips on the hot deck path.
  const activeMetros = await getActiveMetros(input.prisma, null);
  let viewerMetro: (typeof activeMetros)[number] | null = null;
  for (const m of activeMetros) {
    const dist = haversineKm(
      { lat: viewerLat, lng: viewerLng },
      { lat: m.centerLat, lng: m.centerLng },
    );
    if (dist <= m.radiusKm) {
      viewerMetro = m;
      break;
    }
  }

  // Candidate query: nearby, visible, moderation-clean, not the viewer.
  // Joins preferences for mutual gender filtering & age window.
  // Photos / prompts existence is materialized into booleans.
  const candidateRows = await input.prisma.$queryRawUnsafe<RawProfileRow[]>(
    `
    SELECT
      p."id"               AS profile_id,
      p."userId"           AS user_id,
      p."displayName"      AS display_name,
      p."bio"              AS bio,
      p."gender"::text     AS gender,
      p."city"             AS city,
      p."heightCm"         AS height_cm,
      p."educationLevel"   AS education_level,
      p."relationshipGoal"::text AS relationship_goal,
      p."interests"        AS interests,
      p."values"           AS values,
      p."isPhotoVerified"  AS is_photo_verified,
      u."status"::text     AS account_status,
      p."visibilityStatus"::text AS visibility_status,
      p."moderationStatus"::text AS moderation_status,
      p."lastActiveAt"     AS last_active_at,
      ST_Y(p."location"::geometry) AS lat,
      ST_X(p."location"::geometry) AS lng,
      pref."minAge"        AS prefs_min_age,
      pref."maxAge"        AS prefs_max_age,
      ARRAY(SELECT x::text FROM unnest(pref."interestedGenders") AS x) AS prefs_interested_genders,
      EXISTS(SELECT 1 FROM "ProfilePhoto" ph WHERE ph."profileId" = p."id" GROUP BY ph."profileId" HAVING COUNT(*) >= 2) AS has_at_least_two_photos,
      COALESCE(jsonb_array_length(p."prompts"), 0) > 0 AS has_at_least_one_prompt
    FROM "Profile" p
    JOIN "User"        u    ON u."id"     = p."userId"
    JOIN "Preferences" pref ON pref."userId" = p."userId"
    WHERE p."userId" <> $1
      AND p."visibilityStatus" = 'visible'
      AND p."moderationStatus" = 'clean'
      AND u."status" = 'active'
      AND ST_DWithin(
        p."location",
        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
        $4
      )
    LIMIT 500
    `,
    input.viewerUserId,
    viewerLng,
    viewerLat,
    maxDistanceKm * 1000,
  );

  // Apply the metro filter in-memory; the deck is bounded to 500 rows
  // so this is cheap and keeps the SQL legible.
  const inMetro = viewerMetro
    ? candidateRows.filter(
        (row) =>
          haversineKm(
            { lat: row.lat, lng: row.lng },
            { lat: viewerMetro!.centerLat, lng: viewerMetro!.centerLng },
          ) <= viewerMetro!.radiusKm,
      )
    : candidateRows;

  // History is scoped to the bounded candidate pool. Fetching a user's
  // entire lifetime history wastes memory; truncating it can resurface
  // previously acted-on candidates. Let matching apply its configured window.
  const candidateIds = inMetro.map((row) => row.user_id);

  // DISC-Q1 — anti-staleness. We pull the set of (target, shownAt) for
  // every card we've surfaced to this viewer in the trailing 7 days.
  // The set is used in two passes:
  //   1) Hard filter — strip candidates the viewer saw recently so the
  //      next deck page returns fresh faces first.
  //   2) Soft fallback — if the hard filter empties the candidate pool,
  //      we re-admit the stale ones but bump `recentImpressions` so the
  //      ranking layer demotes them via `fairnessRotationScore`.
  const impressionsWindow = new Date(
    now.getTime() - IMPRESSION_STALENESS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [blocks, priorSwipes, standingLikes, recentImpressions] = await Promise.all([
    // Blocks (either direction)
    input.prisma.block.findMany({
      where: {
        OR: [
          { blockerUserId: input.viewerUserId, blockedUserId: { in: candidateIds } },
          { blockedUserId: input.viewerUserId, blockerUserId: { in: candidateIds } },
        ],
      },
    }),
    input.prisma.swipeAction.groupBy({
      by: ["targetUserId", "decision"],
      _max: { createdAt: true },
      where: {
        viewerUserId: input.viewerUserId,
        undoneAt: null,
        targetUserId: { in: candidateIds },
      },
    }),
    // Standing likes the viewer sent — exclude those candidates from deck.
    input.prisma.like.findMany({
      where: {
        fromUserId: input.viewerUserId,
        toUserId: { in: candidateIds },
        status: { in: ["active", "matched"] },
      },
      select: { toUserId: true },
    }),
    input.prisma.deckImpression.groupBy({
      by: ["targetUserId"],
      _count: { _all: true },
      where: {
        viewerUserId: input.viewerUserId,
        shownAt: { gt: impressionsWindow },
        targetUserId: { in: candidateIds },
      },
    }),
  ]);
  const likedTargets = new Set(standingLikes.map((l) => l.toUserId));
  const impressionCountByTarget = new Map<string, number>();
  for (const row of recentImpressions) {
    impressionCountByTarget.set(row.targetUserId, row._count._all);
  }
  const recentlyShownTargets = new Set(impressionCountByTarget.keys());

  const viewerMatchingProfile: MatchingProfile = {
    id: viewerUser.profile.id,
    userId: viewerUser.id,
    displayName: viewerUser.profile.displayName,
    age: ageOnDate(viewerUser.dateOfBirth, now),
    gender: viewerUser.profile.gender as MatchingGender,
    location: { lat: viewerLoc[0].lat, lng: viewerLoc[0].lng },
    city: viewerUser.profile.city,
    relationshipGoal:
      viewerUser.profile.relationshipGoal === null
        ? null
        : (viewerUser.profile.relationshipGoal as MatchingRelationshipGoal),
    interests: viewerUser.profile.interests,
    values: viewerUser.profile.values,
    accountStatus: viewerUser.status as MatchingProfile["accountStatus"],
    visibilityStatus: viewerUser.profile.visibilityStatus as MatchingProfile["visibilityStatus"],
    moderationStatus: viewerUser.profile.moderationStatus as MatchingProfile["moderationStatus"],
    lastActiveAt: viewerUser.profile.lastActiveAt,
    publicFields: {
      hasPhotosAtLeastTwo: false,
      hasDisplayName: Boolean(viewerUser.profile.displayName),
      hasAge: true,
      hasGender: true,
      hasBioAtLeast30Chars: viewerUser.profile.bio.length >= 30,
      hasAtLeastOnePrompt: viewerUser.profile.prompts !== null,
      hasAtLeastThreeInterests: viewerUser.profile.interests.length >= 3,
      hasRelationshipGoal: viewerUser.profile.relationshipGoal !== null,
      hasEducationLevel: viewerUser.profile.educationLevel !== null,
      hasCity: viewerUser.profile.city !== null,
    },
    interestedInGenders: viewerUser.preferences.interestedGenders as MatchingGender[],
    candidatePreferredAgeRange: [viewerUser.preferences.minAge, viewerUser.preferences.maxAge],
  };

  const viewer: Viewer = {
    userId: viewerUser.id,
    profile: viewerMatchingProfile,
    preferences: {
      userId: viewerUser.id,
      minAge: viewerUser.preferences.minAge,
      maxAge: viewerUser.preferences.maxAge,
      maxDistanceKm: viewerUser.preferences.maxDistanceKm,
      interestedGenders: viewerUser.preferences.interestedGenders as MatchingGender[],
      relationshipGoals: viewerUser.preferences.relationshipGoals as MatchingRelationshipGoal[],
      excludeIncompatibleGoals: viewerUser.preferences.excludeIncompatibleGoals,
      includeUnansweredOptionalFields: viewerUser.preferences.includeUnansweredOptionalFields,
    },
  };

  // Build candidates, computing age and distance per row.
  //
  // DISC-Q1 — two-phase filter against the 7-day impression set:
  //   * `fresh` = candidates we haven't shown recently.
  //   * `stale` = candidates we have shown but the viewer never swiped
  //     on. Used as a fallback when `fresh` is empty so the viewer
  //     never sees a literally-empty deck just because we've shown
  //     them everyone once.
  const swipedTargets = new Set(priorSwipes.map((s) => s.targetUserId));

  function rowToCandidate(row: RawProfileRow): Candidate {
    const profile = toMatchingProfile(row);
    return {
      profile,
      distanceKm: haversineKm(viewer.profile.location, { lat: row.lat, lng: row.lng }),
      activityBucket: activityBucket(row.last_active_at, now),
      softPreferences: {
        relationshipGoal:
          viewer.profile.relationshipGoal !== null && profile.relationshipGoal !== null
            ? viewer.profile.relationshipGoal === profile.relationshipGoal
            : undefined,
      },
      // Hydrated with the count of times this candidate has appeared in
      // the trailing 7-day window. `fairnessRotationScore` reads this to
      // demote (but not remove) over-served candidates.
      recentImpressions: impressionCountByTarget.get(row.user_id) ?? 0,
    };
  }

  let eligibleRows = inMetro.filter((row) => !likedTargets.has(row.user_id));
  // Trust filter (#8): when the viewer opts into verified-only, drop
  // un-verified candidates before ranking.
  if (viewerUser.preferences.verifiedOnly) {
    eligibleRows = eligibleRows.filter((row) => row.is_photo_verified);
  }
  const freshRows = eligibleRows.filter((row) => !recentlyShownTargets.has(row.user_id));
  // Stale-but-unswiped: candidates the viewer has seen recently but
  // never acted on. Eligible for re-admission when `fresh` is empty.
  const staleUnswipedRows = eligibleRows.filter(
    (row) => recentlyShownTargets.has(row.user_id) && !swipedTargets.has(row.user_id),
  );

  // Focus mode (#10): when on, the deck is intentionally quieted so the user
  // concentrates on existing conversations — return no new cards.
  const candidates: Candidate[] = viewerUser.preferences.focusMode
    ? []
    : freshRows.length > 0
      ? freshRows.map(rowToCandidate)
      : staleUnswipedRows.map(rowToCandidate);

  // Hydrate candidate ages in one round-trip.
  const dobs = await input.prisma.user.findMany({
    where: { id: { in: candidates.map((c) => c.profile.userId) } },
    select: { id: true, dateOfBirth: true },
  });
  const dobByUser = new Map(dobs.map((d) => [d.id, d.dateOfBirth]));
  for (const c of candidates) {
    const dob = dobByUser.get(c.profile.userId);
    if (dob) c.profile.age = ageOnDate(dob, now);
  }

  // Hydrate desirability (#9) and responseRate (#7) for the viewer + the
  // candidate set in two grouped round-trips.
  //   - desirability = normalized incoming-like volume (a proxy for global
  //     desirability per Bruch & Newman); capped so it saturates at 1.
  //   - responseRate = share of post-date feedback about the user that was
  //     positive (respectful and want-to-continue); undefined when no
  //     feedback exists yet so new users stay neutral.
  if (candidates.length > 0) {
    const userIds = [viewerUser.id, ...candidates.map((c) => c.profile.userId)];
    const DESIRABILITY_CAP = 50;
    const [likeCounts, feedback] = await Promise.all([
      input.prisma.like.groupBy({
        by: ["toUserId"],
        where: { toUserId: { in: userIds }, status: { in: ["active", "matched"] } },
        _count: { _all: true },
      }),
      input.prisma.dateFeedback.groupBy({
        by: ["aboutUserId"],
        where: { aboutUserId: { in: userIds } },
        _count: { _all: true },
      }),
    ]);
    const desirabilityByUser = new Map<string, number>();
    for (const r of likeCounts) {
      desirabilityByUser.set(r.toUserId, Math.min(1, r._count._all / DESIRABILITY_CAP));
    }
    // responseRate: a second narrow query for positive-feedback counts, since
    // groupBy can't conditionally sum booleans portably.
    const positiveFeedback = await input.prisma.dateFeedback.groupBy({
      by: ["aboutUserId"],
      where: { aboutUserId: { in: userIds }, respectful: { not: false }, wantToContinue: true },
      _count: { _all: true },
    });
    const totalByUser = new Map(feedback.map((f) => [f.aboutUserId, f._count._all]));
    const positiveByUser = new Map(positiveFeedback.map((f) => [f.aboutUserId, f._count._all]));
    const responseRateByUser = new Map<string, number>();
    for (const [uid, total] of totalByUser) {
      if (total > 0) responseRateByUser.set(uid, (positiveByUser.get(uid) ?? 0) / total);
    }

    viewer.profile.desirability = desirabilityByUser.get(viewerUser.id) ?? 0;
    for (const c of candidates) {
      c.profile.desirability = desirabilityByUser.get(c.profile.userId) ?? 0;
      const rr = responseRateByUser.get(c.profile.userId);
      if (rr !== undefined) c.responseRate = rr;
    }
  }

  // Resolve the viewer's selected matching preset into a concrete config
  // (weights + pinned strategy). The catalog read is cached
  // (lib/matching-presets) so this stays cheap on the hot path; an
  // unknown/disabled selection falls back to the default preset.
  const catalog = await getPresetCatalog(input.prisma);
  const presetKey = resolveActivePresetKey(catalog, viewerUser.preferences.discoveryPresetKey);
  const config = resolveConfig(currentConfig, { presetKey, presets: catalog.presets });

  // PLATFORM-PLUGIN — when OPENMATCH_RANKING_PROVIDER is set, forks/ops route
  // the deck through that explicit RankingProvider (it wins over the preset
  // strategy). When unset, getRankingProvider() returns undefined and the
  // deck ranks via the preset's strategy so the user's selection takes effect.
  return getDiscoveryDeck({
    viewer,
    candidates,
    blocks: blocks.map((b) => ({
      blockerId: b.blockerUserId,
      blockedId: b.blockedUserId,
    })),
    priorSwipes: priorSwipes.map((s) => ({
      viewerId: input.viewerUserId,
      targetUserId: s.targetUserId,
      decision: s.decision === "like" ? "like" : "reject",
      createdAt: s._max.createdAt!,
      undoneAt: null,
    })),
    now,
    limit: input.limit,
    deckSessionId: input.deckSessionId,
    config,
    rankingProvider: getRankingProvider(),
  });
}

// DISC-Q1 — impressions recording. Called from the `/discovery/impressions`
// route when iOS pings up the list of cards it just rendered. We dedupe
// against the (viewer, target, deckSession) tuple to keep the index
// tight even if the client re-pings on a scroll-back.
export interface RecordImpressionsInput {
  prisma: PrismaClient;
  viewerUserId: string;
  deckSessionId: string;
  targetUserIds: string[];
}

export async function recordDeckImpressions(input: RecordImpressionsInput): Promise<number> {
  const unique = Array.from(new Set(input.targetUserIds)).filter((id) => id !== input.viewerUserId);
  if (unique.length === 0) return 0;
  const result = await input.prisma.deckImpression.createMany({
    data: unique.map((targetUserId) => ({
      viewerUserId: input.viewerUserId,
      targetUserId,
      deckSessionId: input.deckSessionId,
    })),
    // Skip duplicates is unsupported on this composite (no unique key)
    // so we just let multiple rows land if the client double-pings; the
    // 7-day filter is a set membership lookup which dedupes implicitly.
  });
  return result.count;
}

// DISC-Q1 — prune helper for the daily cron. Deletes impressions older
// than 30 days so the table stays bounded.
export const IMPRESSION_PRUNE_DAYS = 30;
export async function pruneOldDeckImpressions(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - IMPRESSION_PRUNE_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.deckImpression.deleteMany({
    where: { shownAt: { lt: cutoff } },
  });
  return result.count;
}
