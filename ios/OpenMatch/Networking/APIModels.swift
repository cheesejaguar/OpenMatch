import Foundation

// Transport types for the OpenMatch REST API.
// These mirror docs/api/openapi.yaml and the Fastify route schemas.

struct StartLoginRequest: Codable {
    let method: String
    let email: String?
    let appleIdentityToken: String?
    let devUserId: String?
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

    var id: String { profileId }
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

struct MessageDTO: Codable, Identifiable {
    let id: String
    let conversationId: String
    let senderUserId: String
    let body: String
    let createdAt: Date
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
}

enum LikesVisibility: String, Codable {
    case visible
    case count_only
    case hidden
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
