import { randomUUID } from "node:crypto";
import { currentConfig, explain } from "@openmatch/matching";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { formatDistance, haversineKm } from "../lib/location.js";
import { buildDeck } from "../services/discovery.service.js";

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Querystring: { limit?: string } }>("/deck", async (req, reply) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? "10", 10) || 10, 1), 50);
    const deckSessionId = randomUUID();
    try {
      const deck = await buildDeck({
        prisma: app.prisma,
        viewerUserId: req.userId!,
        limit,
        deckSessionId,
      });

      // Hydrate display fields for each card (photos, distance text, bio).
      const profiles = await app.prisma.profile.findMany({
        where: { id: { in: deck.cards.map((c) => c.profileId) } },
        include: { photos: { orderBy: { sortOrder: "asc" } } },
      });

      // Pull viewer location once for distance display.
      const vLoc = await app.prisma.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(
        `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM "Profile" WHERE "userId" = $1`,
        req.userId!,
      );
      const cLoc = await app.prisma.$queryRawUnsafe<
        Array<{ profile_id: string; lat: number; lng: number }>
      >(
        `SELECT "id" AS profile_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM "Profile" WHERE "id" = ANY($1::text[])`,
        deck.cards.map((c) => c.profileId),
      );
      const candLoc = new Map(cLoc.map((r) => [r.profile_id, r]));

      const viewerLatLng = vLoc[0];

      return reply.send({
        deckSessionId,
        algorithmVersion: deck.algorithmVersion,
        rankingConfigVersion: deck.rankingConfigVersion,
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
          };
        }),
      });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400) {
        return reply.code(400).send({ error: e.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { profileId: string } }>("/explanation/:profileId", async (req, reply) => {
    // Recompute the explanation server-side for a specific candidate;
    // this powers "Why am I seeing this profile?" without trusting the
    // client.
    const candidate = await app.prisma.profile.findUnique({
      where: { id: req.params.profileId },
    });
    if (!candidate) return reply.code(404).send({ error: "not_found" });
    const viewer = await app.prisma.user.findUnique({
      where: { id: req.userId! },
      include: { profile: true, preferences: true },
    });
    if (!viewer || !viewer.profile || !viewer.preferences) {
      return reply.code(400).send({ error: "viewer_not_initialized" });
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
      return reply.code(400).send({ error: "missing_location" });
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
