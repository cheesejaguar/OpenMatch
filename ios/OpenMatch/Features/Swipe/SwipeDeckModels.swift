import Foundation

enum SwipeDecision: String, Codable {
    case like
    case reject
}

struct ProfileCardModel: Identifiable, Equatable {
    let profileId: String
    let userId: String
    let displayName: String
    let bio: String
    let distanceText: String
    let photos: [PhotoDTO]
    let interests: [String]
    let pronouns: String?
    let relationshipGoal: String?
    let city: String?
    let explanation: ExplanationDTO
    // DISC-Q4 — backend-computed flag; true when the candidate was
    // active in the last 24h. We surface a small green dot + "Active
    // today" label on the swipe card when this is true.
    let recentlyActive: Bool
    /// Trust & safety automation — admin-confirmed selfie-pose verification.
    let isPhotoVerified: Bool

    var id: String { profileId }

    init(from card: DeckCardDTO) {
        self.profileId = card.profileId
        self.userId = card.userId
        self.displayName = card.displayName
        self.bio = card.bio
        self.distanceText = card.distanceText
        self.photos = card.photos
        self.interests = card.interests
        self.pronouns = card.pronouns
        self.relationshipGoal = card.relationshipGoal
        self.city = card.city
        self.explanation = card.explanation
        self.recentlyActive = card.recentlyActive ?? false
        self.isPhotoVerified = card.isPhotoVerified ?? false
    }

    // Test / preview helper.
    init(
        profileId: String,
        userId: String,
        displayName: String,
        bio: String,
        distanceText: String,
        photos: [PhotoDTO],
        interests: [String],
        pronouns: String?,
        relationshipGoal: String?,
        city: String?,
        explanation: ExplanationDTO,
        recentlyActive: Bool = false,
        isPhotoVerified: Bool = false
    ) {
        self.profileId = profileId
        self.userId = userId
        self.displayName = displayName
        self.bio = bio
        self.distanceText = distanceText
        self.photos = photos
        self.interests = interests
        self.pronouns = pronouns
        self.relationshipGoal = relationshipGoal
        self.city = city
        self.explanation = explanation
        self.recentlyActive = recentlyActive
        self.isPhotoVerified = isPhotoVerified
    }

    static func == (lhs: ProfileCardModel, rhs: ProfileCardModel) -> Bool {
        lhs.profileId == rhs.profileId
    }
}

struct PendingSwipeAction: Identifiable, Equatable {
    let id: UUID
    let card: ProfileCardModel
    let decision: SwipeDecision
    let createdAt: Date
    var swipeId: String?

    init(id: UUID, card: ProfileCardModel, decision: SwipeDecision, createdAt: Date, swipeId: String? = nil) {
        self.id = id
        self.card = card
        self.decision = decision
        self.createdAt = createdAt
        self.swipeId = swipeId
    }
}
