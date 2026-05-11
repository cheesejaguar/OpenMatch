import XCTest
@testable import OpenMatch

@MainActor
final class SwipeDeckModelsTests: XCTestCase {
    func testCardEquality() {
        let dto1 = DeckCardDTO(
            profileId: "p1", userId: "u1", displayName: "A", bio: "", gender: nil,
            pronouns: nil, relationshipGoal: nil, city: nil,
            distanceText: "Nearby", photos: [], interests: [],
            explanation: ExplanationDTO(summary: "", keys: [])
        )
        let dto2 = DeckCardDTO(
            profileId: "p1", userId: "u-different", displayName: "A different name", bio: "x", gender: nil,
            pronouns: nil, relationshipGoal: nil, city: nil,
            distanceText: "Far", photos: [], interests: [],
            explanation: ExplanationDTO(summary: "x", keys: [])
        )
        let m1 = ProfileCardModel(from: dto1)
        let m2 = ProfileCardModel(from: dto2)
        XCTAssertEqual(m1, m2, "Two cards with the same profileId compare equal")
    }

    func testPendingSwipeActionId() {
        let dto = DeckCardDTO(
            profileId: "p1", userId: "u1", displayName: "A", bio: "", gender: nil,
            pronouns: nil, relationshipGoal: nil, city: nil,
            distanceText: "Nearby", photos: [], interests: [],
            explanation: ExplanationDTO(summary: "", keys: [])
        )
        let card = ProfileCardModel(from: dto)
        let action = PendingSwipeAction(id: UUID(), card: card, decision: .like, createdAt: Date())
        XCTAssertEqual(action.card.profileId, "p1")
        XCTAssertEqual(action.decision, .like)
    }
}

@MainActor
final class LikesVisibilityTests: XCTestCase {
    func testRawValues() {
        XCTAssertEqual(LikesVisibility.visible.rawValue, "visible")
        XCTAssertEqual(LikesVisibility.count_only.rawValue, "count_only")
        XCTAssertEqual(LikesVisibility.hidden.rawValue, "hidden")
    }
}
