import { getDiscoveryDeck, currentConfig } from "@openmatch/matching";
import type {
  ActivityBucket,
  Candidate,
  Gender as MatchingGender,
  Profile as MatchingProfile,
  RelationshipGoal as MatchingRelationshipGoal,
  Viewer,
} from "@openmatch/matching";
import type { PrismaClient } from "@prisma/client";
import { haversineKm } from "../lib/location.js";

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
      row.relationship_goal === null
        ? null
        : (row.relationship_goal as MatchingRelationshipGoal),
    interests: row.interests,
    accountStatus: row.account_status as MatchingProfile["accountStatus"],
    visibilityStatus:
      row.visibility_status as MatchingProfile["visibilityStatus"],
    moderationStatus:
      row.moderation_status as MatchingProfile["moderationStatus"],
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

function ageFromDob(dob: Date, now: Date): number {
  const ms = now.getTime() - dob.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
}

export interface BuildDeckInput {
  prisma: PrismaClient;
  viewerUserId: string;
  limit: number;
  deckSessionId: string;
  now?: Date;
}

export async function buildDeck(input: BuildDeckInput) {
  const now = input.now ?? new Date();
  const viewerUser = await input.prisma.user.findUnique({
    where: { id: input.viewerUserId },
    include: { profile: true, preferences: true },
  });
  if (!viewerUser || !viewerUser.profile || !viewerUser.preferences) {
    throw Object.assign(new Error("viewer_not_initialized"), { statusCode: 400 });
  }

  // Pull viewer location.
  const viewerLoc = await input.prisma.$queryRawUnsafe<
    Array<{ lat: number; lng: number }>
  >(
    `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM "Profile" WHERE "userId" = $1`,
    input.viewerUserId,
  );
  if (!viewerLoc[0]) {
    throw Object.assign(new Error("viewer_has_no_location"), { statusCode: 400 });
  }

  const maxDistanceKm = viewerUser.preferences.maxDistanceKm;

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
      AND u."status" = 'active'
      AND ST_DWithin(
        p."location",
        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
        $4
      )
    LIMIT 500
    `,
    input.viewerUserId,
    viewerLoc[0].lng,
    viewerLoc[0].lat,
    maxDistanceKm * 1000,
  );

  // Blocks (either direction)
  const blocks = await input.prisma.block.findMany({
    where: {
      OR: [
        { blockerUserId: input.viewerUserId },
        { blockedUserId: input.viewerUserId },
      ],
    },
  });

  const priorSwipes = await input.prisma.swipeAction.findMany({
    where: { viewerUserId: input.viewerUserId },
  });

  // Standing likes the viewer sent — exclude those candidates from deck.
  const standingLikes = await input.prisma.like.findMany({
    where: {
      fromUserId: input.viewerUserId,
      status: { in: ["active", "matched"] },
    },
    select: { toUserId: true },
  });
  const likedTargets = new Set(standingLikes.map((l) => l.toUserId));

  const viewerMatchingProfile: MatchingProfile = {
    id: viewerUser.profile.id,
    userId: viewerUser.id,
    displayName: viewerUser.profile.displayName,
    age: ageFromDob(viewerUser.dateOfBirth, now),
    gender: viewerUser.profile.gender as MatchingGender,
    location: { lat: viewerLoc[0].lat, lng: viewerLoc[0].lng },
    city: viewerUser.profile.city,
    relationshipGoal:
      viewerUser.profile.relationshipGoal === null
        ? null
        : (viewerUser.profile.relationshipGoal as MatchingRelationshipGoal),
    interests: viewerUser.profile.interests,
    accountStatus: viewerUser.status as MatchingProfile["accountStatus"],
    visibilityStatus:
      viewerUser.profile.visibilityStatus as MatchingProfile["visibilityStatus"],
    moderationStatus:
      viewerUser.profile.moderationStatus as MatchingProfile["moderationStatus"],
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
    interestedInGenders: viewerUser.preferences
      .interestedGenders as MatchingGender[],
    candidatePreferredAgeRange: [
      viewerUser.preferences.minAge,
      viewerUser.preferences.maxAge,
    ],
  };

  const viewer: Viewer = {
    userId: viewerUser.id,
    profile: viewerMatchingProfile,
    preferences: {
      userId: viewerUser.id,
      minAge: viewerUser.preferences.minAge,
      maxAge: viewerUser.preferences.maxAge,
      maxDistanceKm: viewerUser.preferences.maxDistanceKm,
      interestedGenders: viewerUser.preferences
        .interestedGenders as MatchingGender[],
      relationshipGoals: viewerUser.preferences
        .relationshipGoals as MatchingRelationshipGoal[],
      excludeIncompatibleGoals: viewerUser.preferences.excludeIncompatibleGoals,
      includeUnansweredOptionalFields:
        viewerUser.preferences.includeUnansweredOptionalFields,
    },
  };

  // Build candidates, computing age and distance per row.
  const candidates: Candidate[] = candidateRows
    .filter((row) => !likedTargets.has(row.user_id))
    .map((row) => {
      const profile = toMatchingProfile(row);
      const candidateUser = candidateRows.find(
        (r) => r.profile_id === row.profile_id,
      )!;
      // Age requires DOB which isn't joined — fetch DOB cheaply.
      // We accept a follow-up query rather than coupling matching to age math.
      return {
        profile,
        distanceKm: haversineKm(
          viewer.profile.location,
          { lat: row.lat, lng: row.lng },
        ),
        activityBucket: activityBucket(row.last_active_at, now),
        softPreferences: {
          relationshipGoal:
            viewer.profile.relationshipGoal !== null &&
            profile.relationshipGoal !== null
              ? viewer.profile.relationshipGoal === profile.relationshipGoal
              : undefined,
        },
        recentImpressions: 0,
      };
    });

  // Hydrate candidate ages in one round-trip.
  const dobs = await input.prisma.user.findMany({
    where: { id: { in: candidates.map((c) => c.profile.userId) } },
    select: { id: true, dateOfBirth: true },
  });
  const dobByUser = new Map(dobs.map((d) => [d.id, d.dateOfBirth]));
  for (const c of candidates) {
    const dob = dobByUser.get(c.profile.userId);
    if (dob) c.profile.age = ageFromDob(dob, now);
  }

  return getDiscoveryDeck({
    viewer,
    candidates,
    blocks: blocks.map((b) => ({
      blockerId: b.blockerUserId,
      blockedId: b.blockedUserId,
    })),
    priorSwipes: priorSwipes.map((s) => ({
      viewerId: s.viewerUserId,
      targetUserId: s.targetUserId,
      decision: s.decision === "like" ? "like" : "reject",
      createdAt: s.createdAt,
      undoneAt: s.undoneAt,
    })),
    now,
    limit: input.limit,
    deckSessionId: input.deckSessionId,
    config: currentConfig,
  });
}
