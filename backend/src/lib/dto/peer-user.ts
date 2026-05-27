import type { Prisma } from "@prisma/client";

// SEV-A3: explicit allow-list of User / Profile / Photo columns that
// are safe to return when one authenticated user reads another user's
// data (peer-visible surfaces: matches, conversations, public profile).
//
// Columns deliberately NOT in this list and the reason:
//   - User.emailHash       — unsalted SHA-256 of email, confirms email guesses
//   - User.phoneHash       — same primitive applied to phone numbers
//   - User.authProvider    — internal, leaks which IdP a peer used
//   - User.authSubject     — Apple `sub` identifier
//   - User.dateOfBirth     — raw DOB; the API surfaces `age` via the
//                            ranker layer, not from this DTO. Including
//                            raw DOB would let peers compute an exact
//                            birthday and use it for SSO recovery.
//   - User.status          — internal lifecycle state ("active" / "paused"
//                            / "deleted") that leaks moderation outcomes
//   - User.isBanned / isAgeVerified — moderation state
//   - Profile.location     — raw PostGIS geography; we expose distance
//                            via the discovery ranker, never lat/lng.
//   - Profile.declaredLocation — same
//
// Any future column added to the schema must be reviewed against this
// list before it can be returned over peer-visible routes. The guard
// spec in test/peer-dto-safety.spec.ts asserts this set.

export const PEER_VISIBLE_USER_SELECT = {
  id: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

export const PEER_VISIBLE_PHOTO_SELECT = {
  id: true,
  cdnUrl: true,
  sortOrder: true,
} as const satisfies Prisma.ProfilePhotoSelect;

export const PEER_VISIBLE_PROFILE_SELECT = {
  id: true,
  displayName: true,
  bio: true,
  gender: true,
  pronouns: true,
  city: true,
  country: true,
  heightCm: true,
  educationLevel: true,
  college: true,
  jobTitle: true,
  company: true,
  companyDisplayEnabled: true,
  relationshipGoal: true,
  childrenStatus: true,
  familyPlans: true,
  drinking: true,
  smoking: true,
  cannabis: true,
  exercise: true,
  diet: true,
  religion: true,
  politics: true,
  languages: true,
  interests: true,
  // Selected core values — surfaced so the client can show shared values (#6).
  values: true,
  prompts: true,
  visibilityStatus: true,
  verificationStatus: true,
  // Trust & safety automation — admin-confirmed selfie-pose
  // verification. Shown as a badge on cards / detail sheets.
  isPhotoVerified: true,
  // Pulled in via the include below; the photo select is its own
  // explicit allow-list.
} as const satisfies Prisma.ProfileSelect;

// Composite select used by listMatches / GET /matches/:matchId. The
// shape mirrors what iOS expects (userA + userB + conversation with
// last message) but every nested level is explicit-select.
export const MATCH_PEER_SELECT = {
  id: true,
  createdAt: true,
  status: true,
  unmatchedAt: true,
  unmatchedByUserId: true,
  userAId: true,
  userBId: true,
  conversation: {
    select: {
      id: true,
      status: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: {
          id: true,
          body: true,
          senderUserId: true,
          createdAt: true,
        },
      },
    },
  },
  userA: {
    select: {
      ...PEER_VISIBLE_USER_SELECT,
      profile: {
        select: {
          ...PEER_VISIBLE_PROFILE_SELECT,
          photos: {
            orderBy: { sortOrder: "asc" as const },
            select: PEER_VISIBLE_PHOTO_SELECT,
          },
        },
      },
    },
  },
  userB: {
    select: {
      ...PEER_VISIBLE_USER_SELECT,
      profile: {
        select: {
          ...PEER_VISIBLE_PROFILE_SELECT,
          photos: {
            orderBy: { sortOrder: "asc" as const },
            select: PEER_VISIBLE_PHOTO_SELECT,
          },
        },
      },
    },
  },
} as const satisfies Prisma.MatchSelect;

export const CONVERSATION_PEER_SELECT = {
  id: true,
  status: true,
  updatedAt: true,
  match: {
    select: {
      id: true,
      status: true,
      userAId: true,
      userBId: true,
      userA: {
        select: {
          ...PEER_VISIBLE_USER_SELECT,
          profile: {
            select: {
              ...PEER_VISIBLE_PROFILE_SELECT,
              photos: {
                orderBy: { sortOrder: "asc" as const },
                select: PEER_VISIBLE_PHOTO_SELECT,
              },
            },
          },
        },
      },
      userB: {
        select: {
          ...PEER_VISIBLE_USER_SELECT,
          profile: {
            select: {
              ...PEER_VISIBLE_PROFILE_SELECT,
              photos: {
                orderBy: { sortOrder: "asc" as const },
                select: PEER_VISIBLE_PHOTO_SELECT,
              },
            },
          },
        },
      },
    },
  },
  messages: {
    take: 1,
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      body: true,
      senderUserId: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.ConversationSelect;

// Public profile DTO returned by `GET /api/v1/profile/:profileId`.
// Excludes Profile.location and declaredLocation (both raw geographies)
// as well as any internal moderation columns.
export const PUBLIC_PROFILE_SELECT = {
  ...PEER_VISIBLE_PROFILE_SELECT,
  userId: true,
  photos: {
    orderBy: { sortOrder: "asc" as const },
    select: PEER_VISIBLE_PHOTO_SELECT,
  },
} as const satisfies Prisma.ProfileSelect;
