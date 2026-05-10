import scenarios from "../fixtures/scenarios.json" with { type: "json" };
import users from "../fixtures/synthetic-users.json" with { type: "json" };
import type {
  ActivityBucket,
  Block,
  Candidate,
  ModerationStatus,
  Preferences,
  PriorSwipe,
  Profile,
  RelationshipGoal,
  Viewer,
} from "../src/types.js";

interface RawUser {
  id: string;
  displayName: string;
  age: number;
  gender: string;
  lat: number;
  lng: number;
  city: string;
  relationshipGoal: string;
  interests: string[];
  interestedInGenders: string[];
  ageRange: [number, number];
  lastActiveHoursAgo: number;
  moderationStatus: string;
}

const ALL: Record<string, RawUser> = Object.fromEntries(
  (users.users as RawUser[]).map((u) => [u.id, u]),
);

function activityBucketFromHours(hours: number): ActivityBucket {
  if (hours <= 24) return "within24h";
  if (hours <= 24 * 7) return "within7d";
  if (hours <= 24 * 30) return "within30d";
  return "older";
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function toProfile(u: RawUser): Profile {
  return {
    id: `profile-${u.id}`,
    userId: u.id,
    displayName: u.displayName,
    age: u.age,
    gender: u.gender as Profile["gender"],
    location: { lat: u.lat, lng: u.lng },
    city: u.city,
    relationshipGoal: u.relationshipGoal as RelationshipGoal,
    interests: u.interests,
    accountStatus: "active",
    visibilityStatus: "visible",
    moderationStatus: u.moderationStatus as ModerationStatus,
    lastActiveAt: new Date(Date.now() - u.lastActiveHoursAgo * 3600 * 1000),
    publicFields: {
      hasPhotosAtLeastTwo: true,
      hasDisplayName: true,
      hasAge: true,
      hasGender: true,
      hasBioAtLeast30Chars: true,
      hasAtLeastOnePrompt: true,
      hasAtLeastThreeInterests: u.interests.length >= 3,
      hasRelationshipGoal: true,
      hasEducationLevel: true,
      hasCity: !!u.city,
    },
    interestedInGenders: u.interestedInGenders as Profile["gender"][],
    candidatePreferredAgeRange: u.ageRange,
  };
}

export function makeViewer(scenarioName: string): Viewer {
  const scenario = (
    scenarios.scenarios as Record<
      string,
      { viewerId: string; preferences: Omit<Preferences, "userId"> }
    >
  )[scenarioName];
  if (!scenario) throw new Error(`unknown scenario ${scenarioName}`);
  const raw = ALL[scenario.viewerId];
  if (!raw) throw new Error(`unknown user ${scenario.viewerId}`);
  return {
    userId: raw.id,
    profile: toProfile(raw),
    preferences: { userId: raw.id, ...scenario.preferences },
  };
}

export function makeCandidates(viewer: Viewer, excludeIds: string[] = []): Candidate[] {
  return (users.users as RawUser[])
    .filter((u) => u.id !== viewer.userId && !excludeIds.includes(u.id))
    .map((u) => {
      const profile = toProfile(u);
      return {
        profile,
        distanceKm: haversineKm(viewer.profile.location, profile.location),
        activityBucket: activityBucketFromHours(u.lastActiveHoursAgo),
        softPreferences: {
          relationshipGoal:
            viewer.profile.relationshipGoal !== null && profile.relationshipGoal !== null
              ? viewer.profile.relationshipGoal === profile.relationshipGoal
              : undefined,
        },
        recentImpressions: 0,
      };
    });
}

export const emptyBlocks: Block[] = [];
export const emptySwipes: PriorSwipe[] = [];
export const FIXED_NOW = new Date("2026-05-10T12:00:00.000Z");
