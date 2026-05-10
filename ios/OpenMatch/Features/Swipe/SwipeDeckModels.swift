import Foundation

enum SwipeDecision: String, Codable {
    case like
    case reject
}

struct ProfileCardModel: Identifiable, Equatable {
    let profileId: String
    let displayName: String
    let bio: String
    let distanceText: String
    let photos: [PhotoDTO]
    let interests: [String]
    let pronouns: String?
    let relationshipGoal: String?
    let city: String?
    let explanation: ExplanationDTO

    var id: String { profileId }

    init(from card: DeckCardDTO) {
        self.profileId = card.profileId
        self.displayName = card.displayName
        self.bio = card.bio
        self.distanceText = card.distanceText
        self.photos = card.photos
        self.interests = card.interests
        self.pronouns = card.pronouns
        self.relationshipGoal = card.relationshipGoal
        self.city = card.city
        self.explanation = card.explanation
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
