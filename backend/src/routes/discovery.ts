import { randomUUID } from "node:crypto";
import { currentConfig, explain } from "@openmatch/matching";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorCodes } from "../lib/error-codes.js";
import { httpError, sendHttpError } from "../lib/http-error.js";
import { formatDistance, haversineKm } from "../lib/location.js";
import { buildDeck, recordDeckImpressions } from "../services/discovery.service.js";

// Zod-validated deck querystring. Replaces a hand-rolled
// `Number.parseInt(req.query.limit ?? "10")` so the handler gets a
// typed `limit: number` and bad input now surfaces as a 400 with
// `error: "validation_failed"` instead of silently coercing to 10.
const deckQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// DISC-Q1 — anti-staleness impressions ping. iOS POSTs the set of card
// userIds it has shown on screen so the next deck excludes them from
// the trailing 7-day window. `deckSessionId` is opaque; we persist it
// for forensic / dashboard reasons but don't gate on it.
const impressionsBodySchema = z.object({
  deckSessionId: z.string().min(1).max(64),
  targetUserIds: z.array(z.string().min(1).max(64)).min(1).max(50),
});

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get(
    "/deck",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { limit } = deckQuerySchema.parse(req.query);
      const deckSessionId = randomUUID();
      // PERF — the deck mutates on every call (swipes filter the next
      // page) so it must never be cached by an intermediary, the user
      // agent, or a service worker. Explicitly opt out.
      reply.header("cache-control", "no-store");
      try {
        const deck = await buildDeck({
          prisma: app.prisma,
          viewerUserId: req.userId!,
          limit,
          deckSessionId,
        });

        // PERF-X17 — these three lookups are mutually independent
        // (profiles by id-set, viewer lat/lng, candidate lat/lng) so
        // fan them out via Promise.all. The previous sequential awaits
        // stacked three network round-trips on Neon's WebSocket
        // connection per /deck request; parallelising collapses them
        // into roughly one RTT.
        //
        // The full deck consolidation into a single CTE that also
        // jsonb_agg's photos + dateOfBirth (PERF-B1) is a deeper
        // refactor with PostGIS + JSON aggregation testing surface;
        // tracked as a follow-up to this PR. This change captures the
        // sequential-fanout wins without restructuring the SQL.
        const profileIds = deck.cards.map((c) => c.profileId);
        const [profiles, vLoc, cLoc] = await Promise.all([
          app.prisma.profile.findMany({
            where: { id: { in: profileIds } },
            include: { photos: { orderBy: { sortOrder: "asc" } } },
            // PERF — `lastActiveAt` is included in the default select.
            // The DISC-Q4 "recently active" badge keys off it.
          }),
          app.prisma.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
            `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM "Profile" WHERE "userId" = $1`,
            req.userId!,
          ),
          app.prisma.$queryRawUnsafe<Array<{ profile_id: string; lat: number; lng: number }>>(
            `SELECT "id" AS profile_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM "Profile" WHERE "id" = ANY($1::text[])`,
            profileIds,
          ),
        ]);
        const candLoc = new Map(cLoc.map((r) => [r.profile_id, r]));

        const viewerLatLng = vLoc[0];

        return reply.send({
          deckSessionId,
          algorithmVersion: deck.algorithmVersion,
          rankingConfigVersion: deck.rankingConfigVersion,
          strategyId: deck.strategyId,
          cards: deck.cards.map((card) => {
            const profile = profiles.find((p) => p.id === card.profileId);
            const candLatLng = candLoc.get(card.profileId);
            const distanceKm =
              viewerLatLng && candLatLng
                ? haversineKm(
                    { lat: viewerLatLng.lat, lng: viewerLatLng.lng },
                    { lat: candLatLng.lat, lng: candLatLng.lng },
                  )
                : 0;
            // DISC-Q4 — "Active today" badge. Cheap win: surface a
            // boolean off `Profile.lastActiveAt` so iOS doesn't need to
            // ship a date-diff. Threshold matches the badge label
            // ("Active today" ↔ last 24h).
            const recentlyActive = profile
              ? Date.now() - profile.lastActiveAt.getTime() < 24 * 60 * 60 * 1000
              : false;
            return {
              profileId: card.profileId,
              // The owning user id is exposed so clients can call block/report
              // without an extra round-trip. It's already known to anyone who
              // matches or likes this profile; no additional disclosure here.
              userId: profile?.userId ?? "",
              displayName: profile?.displayName ?? "",
              bio: profile?.bio ?? "",
              gender: profile?.gender,
              pronouns: profile?.pronouns ?? null,
              relationshipGoal: profile?.relationshipGoal ?? null,
              city: profile?.city ?? null,
              distanceText: formatDistance(distanceKm).text,
              photos: profile?.photos ?? [],
              interests: profile?.interests ?? [],
              prompts: profile?.prompts ?? null,
              explanation: card.explanation,
              recentlyActive,
              // Trust & safety automation — surfaced so iOS can render
              // the verified badge. False by default until an admin
              // approves the user's selfie-pose verification request.
              isPhotoVerified: profile?.isPhotoVerified ?? false,
            };
          }),
        });
      } catch (err) {
        // Discovery service throws { statusCode: 400, message: "<code>" }
        // for the viewer-not-ready / no-location cases. Forward the code
        // verbatim so iOS branches on viewer_has_no_location vs
        // viewer_not_initialized.
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 400) {
          return reply.code(400).send({ error: e.message ?? ErrorCodes.INVALID_REQUEST });
        }
        throw err;
      }
    },
  );

  app.post(
    "/impressions",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = impressionsBodySchema.parse(req.body);
      const count = await recordDeckImpressions({
        prisma: app.prisma,
        viewerUserId: req.userId!,
        deckSessionId: body.deckSessionId,
        targetUserIds: body.targetUserIds,
      });
      return reply.send({ recorded: count });
    },
  );

  app.get<{ Params: { profileId: string } }>("/explanation/:profileId", async (req, reply) => {
    // Recompute the explanation server-side for a specific candidate;
    // this powers "Why am I seeing this profile?" without trusting the
    // client.
    const candidate = await app.prisma.profile.findUnique({
      where: { id: req.params.profileId },
    });
    if (!candidate) return sendHttpError(reply, httpError(ErrorCodes.NOT_FOUND));
    const viewer = await app.prisma.user.findUnique({
      where: { id: req.userId! },
      include: { profile: true, preferences: true },
    });
    if (!viewer || !viewer.profile || !viewer.preferences) {
      return sendHttpError(reply, httpError(ErrorCodes.VIEWER_NOT_INITIALIZED));
    }
    // Use the matching package's explain() with a minimal hydrated pair.
    // Distance & activity bucket are computed from raw rows.
    const vLocRows = await app.prisma.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
      `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM "Profile" WHERE "userId" = $1`,
      req.userId!,
    );
    const cLocRows = await app.prisma.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
      `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM "Profile" WHERE "id" = $1`,
      candidate.id,
    );
    const vLoc = vLocRows[0];
    const cLoc = cLocRows[0];
    if (!vLoc || !cLoc) {
      return sendHttpError(reply, httpError(ErrorCodes.MISSING_LOCATION));
    }
    const vLat = vLoc.lat;
    const vLng = vLoc.lng;
    const cLat = cLoc.lat;
    const cLng = cLoc.lng;
    const distanceKm = haversineKm({ lat: vLat, lng: vLng }, { lat: cLat, lng: cLng });

    const hoursSince = Math.floor((Date.now() - candidate.lastActiveAt.getTime()) / 3_600_000);
    const activityBucket =
      hoursSince <= 24
        ? "within24h"
        : hoursSince <= 24 * 7
          ? "within7d"
          : hoursSince <= 24 * 30
            ? "within30d"
            : "older";

    const dobAge = (dob: Date) =>
      Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    const candidateUser = await app.prisma.user.findUnique({
      where: { id: candidate.userId },
      select: { dateOfBirth: true },
    });

    const explanation = explain(
      {
        userId: viewer.id,
        profile: {
          id: viewer.profile.id,
          userId: viewer.id,
          displayName: viewer.profile.displayName,
          age: dobAge(viewer.dateOfBirth),
          gender: viewer.profile.gender as never,
          location: { lat: vLat, lng: vLng },
          city: viewer.profile.city,
          relationshipGoal: viewer.profile.relationshipGoal as never,
          interests: viewer.profile.interests,
          values: viewer.profile.values,
          accountStatus: viewer.status as never,
          visibilityStatus: viewer.profile.visibilityStatus as never,
          moderationStatus: viewer.profile.moderationStatus as never,
          lastActiveAt: viewer.profile.lastActiveAt,
          publicFields: {
            hasPhotosAtLeastTwo: false,
            hasDisplayName: true,
            hasAge: true,
            hasGender: true,
            hasBioAtLeast30Chars: viewer.profile.bio.length >= 30,
            hasAtLeastOnePrompt: viewer.profile.prompts !== null,
            hasAtLeastThreeInterests: viewer.profile.interests.length >= 3,
            hasRelationshipGoal: viewer.profile.relationshipGoal !== null,
            hasEducationLevel: viewer.profile.educationLevel !== null,
            hasCity: viewer.profile.city !== null,
          },
          interestedInGenders: viewer.preferences.interestedGenders as never,
          candidatePreferredAgeRange: [viewer.preferences.minAge, viewer.preferences.maxAge],
        },
        preferences: {
          userId: viewer.id,
          minAge: viewer.preferences.minAge,
          maxAge: viewer.preferences.maxAge,
          maxDistanceKm: viewer.preferences.maxDistanceKm,
          interestedGenders: viewer.preferences.interestedGenders as never,
          relationshipGoals: viewer.preferences.relationshipGoals as never,
          excludeIncompatibleGoals: viewer.preferences.excludeIncompatibleGoals,
          includeUnansweredOptionalFields: viewer.preferences.includeUnansweredOptionalFields,
        },
      },
      {
        profile: {
          id: candidate.id,
          userId: candidate.userId,
          displayName: candidate.displayName,
          age: candidateUser ? dobAge(candidateUser.dateOfBirth) : 0,
          gender: candidate.gender as never,
          location: { lat: cLat, lng: cLng },
          city: candidate.city,
          relationshipGoal: candidate.relationshipGoal as never,
          interests: candidate.interests,
          values: candidate.values,
          accountStatus: "active" as never,
          visibilityStatus: candidate.visibilityStatus as never,
          moderationStatus: candidate.moderationStatus as never,
          lastActiveAt: candidate.lastActiveAt,
          publicFields: {
            hasPhotosAtLeastTwo: true,
            hasDisplayName: true,
            hasAge: true,
            hasGender: true,
            hasBioAtLeast30Chars: candidate.bio.length >= 30,
            hasAtLeastOnePrompt: candidate.prompts !== null,
            hasAtLeastThreeInterests: candidate.interests.length >= 3,
            hasRelationshipGoal: candidate.relationshipGoal !== null,
            hasEducationLevel: candidate.educationLevel !== null,
            hasCity: candidate.city !== null,
          },
          interestedInGenders: [] as never,
          candidatePreferredAgeRange: [18, 99],
        },
        distanceKm,
        activityBucket,
        softPreferences: {},
        recentImpressions: 0,
      },
      currentConfig,
    );
    return explanation;
  });
};
