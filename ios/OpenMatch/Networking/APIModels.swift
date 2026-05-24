import Foundation

// Transport types for the OpenMatch REST API.
// These mirror docs/api/openapi.yaml and the Fastify route schemas.

struct StartLoginRequest: Codable {
    let method: String
    let email: String?
    let appleIdentityToken: String?
    let devUserId: String?
    // Optional invite code. The backend rejects with HTTP 400
    // "invite_required" / "invite_invalid" when the cohort gate is
    // enabled and the code is missing or unknown. (BETA-1 / BETA-5)
    let inviteCode: String?
    // SEV-M5 — raw (unhashed) SIWA nonce. Only sent on Apple sign-in;
    // the backend re-hashes with SHA-256 and compares against the `nonce`
    // claim on the identity-token JWT. Optional so the field can be
    // omitted by email / dev login without changing the on-wire shape.
    let appleRawNonce: String?

    init(
        method: String,
        email: String?,
        appleIdentityToken: String?,
        devUserId: String?,
        inviteCode: String?,
        appleRawNonce: String? = nil
    ) {
        self.method = method
        self.email = email
        self.appleIdentityToken = appleIdentityToken
        self.devUserId = devUserId
        self.inviteCode = inviteCode
        self.appleRawNonce = appleRawNonce
    }
}

struct StartLoginResponse: Codable {
    let challengeId: String
    let message: String?
    let devToken: String?
}

struct VerifyLoginRequest: Codable {
    let challengeId: String
    let token: String
}

struct SessionResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userId: String
    let isNewUser: Bool
}

struct DeckResponseDTO: Codable {
    let deckSessionId: String
    let algorithmVersion: String
    let rankingConfigVersion: String
    let cards: [DeckCardDTO]
}

struct DeckCardDTO: Codable, Identifiable {
    let profileId: String
    let userId: String
    let displayName: String
    let bio: String
    let gender: String?
    let pronouns: String?
    let relationshipGoal: String?
    let city: String?
    let distanceText: String
    let photos: [PhotoDTO]
    let interests: [String]
    let explanation: ExplanationDTO
    // DISC-Q4 — "Active today" badge. true when the candidate's
    // Profile.lastActiveAt is within the trailing 24h. Optional for
    // backwards compatibility with older servers that don't emit it
    // yet; iOS treats `nil` as "unknown / don't render the badge".
    let recentlyActive: Bool?
    /// Trust & safety automation — true once an admin approves the
    /// user's selfie-pose verification request. Older builds + servers
    /// omit this key entirely, so the optional default keeps the
    /// release back-compatible.
    let isPhotoVerified: Bool?

    var id: String { profileId }

    init(
        profileId: String,
        userId: String,
        displayName: String,
        bio: String,
        gender: String?,
        pronouns: String?,
        relationshipGoal: String?,
        city: String?,
        distanceText: String,
        photos: [PhotoDTO],
        interests: [String],
        explanation: ExplanationDTO,
        recentlyActive: Bool? = nil,
        isPhotoVerified: Bool? = nil
    ) {
        self.profileId = profileId
        self.userId = userId
        self.displayName = displayName
        self.bio = bio
        self.gender = gender
        self.pronouns = pronouns
        self.relationshipGoal = relationshipGoal
        self.city = city
        self.distanceText = distanceText
        self.photos = photos
        self.interests = interests
        self.explanation = explanation
        self.recentlyActive = recentlyActive
        self.isPhotoVerified = isPhotoVerified
    }
}

// DISC-Q2 — conversation-starter suggestions returned by
// GET /conversations/:id/suggested-openers.
struct SuggestedOpenerDTO: Codable, Identifiable {
    let text: String
    let sourcePromptQuestion: String?

    // Synthesised — the API doesn't return an id, but SwiftUI's ForEach
    // wants Identifiable. The text alone is unique within the response
    // because the templates and generics never collide.
    var id: String { text }
}

struct SuggestedOpenersResponse: Codable {
    let openers: [SuggestedOpenerDTO]
}

struct PhotoDTO: Codable, Identifiable {
    let id: String
    let cdnUrl: String
    let sortOrder: Int
    let blurhash: String?
}

struct ExplanationDTO: Codable {
    let summary: String
    let keys: [String]
}

struct SwipeRequest: Codable {
    let targetProfileId: String
    let decision: String
    let deckSessionId: String
    let algorithmVersion: String
    let rankingConfigVersion: String
}

struct SwipeResponse: Codable {
    // null when the swipe was a silent no-op (e.g. against a blocked user).
    let swipeId: String?
    let matched: Bool
    let matchId: String?
}

struct LikesListResponse: Codable {
    let visibility: String
    let count: Int?
    let likes: [IncomingLike]
}

struct IncomingLike: Codable, Identifiable {
    let id: String
    let createdAt: Date
    let from: PublicUser
}

struct PublicUser: Codable {
    let id: String
    let profile: PublicProfile?
}

struct PublicProfile: Codable {
    let id: String
    let displayName: String
    let bio: String
    let city: String?
    let photos: [PhotoDTO]
}

struct MatchDTO: Codable, Identifiable {
    let id: String
    let createdAt: Date
    let userA: PublicUser
    let userB: PublicUser
    let conversation: ConversationDTO?
}

struct ConversationDTO: Codable, Identifiable {
    let id: String
    let updatedAt: Date
    let messages: [MessageDTO]?
}

struct MessageDTO: Codable, Identifiable, Equatable {
    let id: String
    let conversationId: String
    let senderUserId: String
    let body: String
    let createdAt: Date
    // Server-known timestamps used by the read-receipt UI under the
    // latest message FROM the current user. Both are optional because a
    // message that hasn't reached the recipient yet has neither set.
    let deliveredAt: Date?
    let readAt: Date?
    // Voice-note payload. When `audioPath` is present, the bubble renders
    // a play button + duration instead of the text body. Bytes are
    // fetched lazily via /audio/:id/url -> /audio/serve.
    let audioPath: String?
    let audioDurationMs: Int?
    // Emoji reactions attached to this message. Defaulted via custom init
    // so older server builds that haven't shipped the field can still
    // decode without breaking the chat UI.
    let reactions: [MessageReactionDTO]

    enum CodingKeys: String, CodingKey {
        case id, conversationId, senderUserId, body, createdAt
        case deliveredAt, readAt
        case audioPath, audioDurationMs
        case reactions
    }

    init(
        id: String,
        conversationId: String,
        senderUserId: String,
        body: String,
        createdAt: Date,
        deliveredAt: Date? = nil,
        readAt: Date? = nil,
        audioPath: String? = nil,
        audioDurationMs: Int? = nil,
        reactions: [MessageReactionDTO] = []
    ) {
        self.id = id
        self.conversationId = conversationId
        self.senderUserId = senderUserId
        self.body = body
        self.createdAt = createdAt
        self.deliveredAt = deliveredAt
        self.readAt = readAt
        self.audioPath = audioPath
        self.audioDurationMs = audioDurationMs
        self.reactions = reactions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.conversationId = try c.decode(String.self, forKey: .conversationId)
        self.senderUserId = try c.decode(String.self, forKey: .senderUserId)
        self.body = try c.decode(String.self, forKey: .body)
        self.createdAt = try c.decode(Date.self, forKey: .createdAt)
        self.deliveredAt = try c.decodeIfPresent(Date.self, forKey: .deliveredAt)
        self.readAt = try c.decodeIfPresent(Date.self, forKey: .readAt)
        self.audioPath = try c.decodeIfPresent(String.self, forKey: .audioPath)
        self.audioDurationMs = try c.decodeIfPresent(Int.self, forKey: .audioDurationMs)
        self.reactions = (try c.decodeIfPresent([MessageReactionDTO].self, forKey: .reactions)) ?? []
    }
}

struct MessageReactionDTO: Codable, Hashable {
    let userId: String
    let emoji: String
    // The server includes a timestamp; the iOS UI doesn't need it today
    // but we decode it for symmetry with the wire shape.
    let createdAt: Date?
}

struct PreferencesDTO: Codable {
    var minAge: Int
    var maxAge: Int
    var maxDistanceKm: Int
    var interestedGenders: [String]
    var relationshipGoals: [String]
    var excludeIncompatibleGoals: Bool
    var includeUnansweredOptionalFields: Bool
    var likesVisibility: String
    var discoveryPaused: Bool
    var handedness: String?
    /// The user's selected matching preset (discovery style). nil means
    /// "use the catalog default", resolved server-side when the deck is built.
    var discoveryPresetKey: String?
}

/// One selectable discovery-style preset surfaced to the user.
struct MatchingPresetOptionDTO: Codable, Hashable {
    let key: String
    let label: String
    let description: String
}

/// Response of GET /api/v1/preferences/matching-presets — the enabled presets
/// a user can choose between, plus which key is the default.
struct MatchingPresetsDTO: Codable {
    let defaultKey: String
    let presets: [MatchingPresetOptionDTO]
}

enum LikesVisibility: String, Codable {
    case visible
    case count_only
    case hidden
}

/// Thumb-reach preference for the swipe deck action row. The server is
/// the source of truth, but the value is also cached in UserDefaults so
/// the UI can render in the user's preferred layout on cold launch
/// before the network round-trip resolves.
enum Handedness: String, Codable, CaseIterable {
    case right
    case left
    case center
}

struct AlgorithmTransparencyDTO: Codable {
    let algorithmVersion: String
    let rankingConfigVersion: String
    let weights: [String: Double]
    let note: String?
    let sourceUrl: String?
}

// MARK: - Profile

// Mirrors backend/prisma/schema.prisma `Profile`. Fields are optional on
// patch; on read everything except photos may be `nil`/empty for a brand
// new profile.
struct ProfileDTO: Codable, Identifiable {
    let id: String
    let userId: String
    let displayName: String
    let bio: String
    let gender: String?
    let pronouns: String?
    let city: String?
    let region: String?
    let country: String?
    let heightCm: Int?
    let relationshipGoal: String?
    let interests: [String]
    let languages: [String]?
    let visibilityStatus: String
    let moderationStatus: String
    let photos: [PhotoDTO]
}

struct ProfileUpdateRequest: Codable {
    var displayName: String?
    var bio: String?
    var gender: String?
    var pronouns: String?
    var city: String?
    var region: String?
    var country: String?
    var heightCm: Int?
    var relationshipGoal: String?
    var languages: [String]?
    var interests: [String]?
    var visibilityStatus: String?
    // ISO-8601 date string; the server enforces 18+ at write time, but
    // we also enforce it on the client side so a clearly-underage user
    // never even gets a network round-trip back to "underage".
    var dateOfBirth: String?
}

// MARK: - Safety

struct BlockedUserDTO: Codable, Identifiable {
    let id: String
    let blockedUserId: String
    let createdAt: Date
}

// MARK: - Realtime

// Ably tokenRequest payload — passed directly to the Ably client SDK on
// iOS once it's wired up. We don't decode the inner fields; Ably's SDK
// owns that contract.
struct AblyTokenRequestDTO: Codable {
    let keyName: String
    let clientId: String?
    let nonce: String
    let timestamp: Int64
    let capability: String
    let ttl: Int?
    let mac: String
}

// MARK: - Privacy & rights (Workstream G)

struct AccountDeletionStatusDTO: Codable, Identifiable {
    let id: String
    let status: String
    let requestedAt: Date?
    let gracePeriodEndsAt: Date
    let cancelledAt: Date?
}

// MARK: - APNs device registration

struct RegisterDeviceRequest: Codable {
    let platform: String   // "ios"
    let token: String      // lowercase hex APNs device token
    let appVersion: String?
    let osVersion: String?
}

// MARK: - Analytics

struct AnalyticsBatch: Codable {
    let events: [AnalyticsEvent]
}

// MARK: - Feedback (IOS-4)

struct FeedbackRequest: Codable {
    let category: String   // "bug" | "suggestion" | "praise" | "other"
    let body: String
    let email: String?
    let appVersion: String?
    let osVersion: String?
    let deviceModel: String?
}

// MARK: - Profile completeness (IOS-6)

// What the swipe deck needs from a profile before it's allowed to
// enter discovery. Mirrors the server's discovery filter exactly so
// the iOS gate doesn't disagree with the server's own filtering.
struct ProfileCompletenessDTO: Codable, Equatable {
    let isComplete: Bool
    let hasPhotos: Bool
    let hasDisplayName: Bool
    let isAgeVerified: Bool
    let photoCount: Int
}

struct NotificationPreferencesDTO: Codable {
    var productNewsEmail: Bool
    var productNewsPush: Bool
    var productNewsSms: Bool
    var newMatchPush: Bool
    var newMessagePush: Bool
    var newLikePush: Bool
    var safetyPush: Bool
    var pushPreviewMode: String   // "full" | "sender_only" | "hidden"
}
