import XCTest
@testable import OpenMatch

// DISC-Q2 / DISC-Q4 — iOS unit tests for:
//   * SuggestedOpenersResponse decoding from the backend shape
//   * ConversationViewModel.shouldShowSuggestedOpeners predicate
//   * DeckCardDTO decodes the optional `recentlyActive` flag
//   * ProfileCardModel exposes recentlyActive to the swipe card

@MainActor
final class SuggestedOpenersDecodingTests: XCTestCase {
    func testSuggestedOpenersResponseDecodes() throws {
        let json = """
        {
          "openers": [
            { "text": "Hey! I noticed you said 'I love hiking' — what got you into that?",
              "sourcePromptQuestion": "What's a hobby you'd love to share?" },
            { "text": "Hi, hope you had a good week!" }
          ]
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let resp = try decoder.decode(SuggestedOpenersResponse.self, from: json)
        XCTAssertEqual(resp.openers.count, 2)
        XCTAssertEqual(resp.openers[0].sourcePromptQuestion, "What's a hobby you'd love to share?")
        XCTAssertNil(resp.openers[1].sourcePromptQuestion)
    }

    func testSuggestedOpenerIsIdentifiable() {
        let opener = SuggestedOpenerDTO(text: "Hello!", sourcePromptQuestion: nil)
        XCTAssertEqual(opener.id, "Hello!")
    }
}

@MainActor
final class ConversationViewModelOpenerTests: XCTestCase {
    func testShouldShowOpenersWhenEmptyChatAndDraftIsBlank() {
        let vm = ConversationViewModel(conversationId: "conv1")
        vm.suggestedOpeners = [
            SuggestedOpenerDTO(text: "Hi!", sourcePromptQuestion: nil),
        ]
        XCTAssertTrue(vm.shouldShowSuggestedOpeners)
    }

    func testShouldNotShowOpenersWhenOpenersAreEmpty() {
        let vm = ConversationViewModel(conversationId: "conv1")
        // No openers loaded — never render the strip.
        XCTAssertFalse(vm.shouldShowSuggestedOpeners)
    }

    func testShouldNotShowOpenersOnceDraftIsNonEmpty() {
        let vm = ConversationViewModel(conversationId: "conv1")
        vm.suggestedOpeners = [
            SuggestedOpenerDTO(text: "Hi!", sourcePromptQuestion: nil),
        ]
        vm.draft = "Already typing"
        XCTAssertFalse(vm.shouldShowSuggestedOpeners)
    }

    func testApplyOpenerInsertsTextWithoutSending() {
        let vm = ConversationViewModel(conversationId: "conv1")
        let opener = SuggestedOpenerDTO(
            text: "Hey, what are you up to today?",
            sourcePromptQuestion: nil
        )
        vm.applySuggestedOpener(opener)
        XCTAssertEqual(vm.draft, "Hey, what are you up to today?")
        // No side effects — the strip predicate now flips because the
        // draft is non-empty, so the strip disappears as the user starts
        // editing.
        XCTAssertFalse(vm.shouldShowSuggestedOpeners)
    }
}

@MainActor
final class RecentlyActiveBadgeTests: XCTestCase {
    func testDeckCardDecodesRecentlyActiveFlag() throws {
        let json = """
        {
          "profileId": "p1",
          "userId": "u1",
          "displayName": "Sam",
          "bio": "Hi there",
          "gender": "Man",
          "pronouns": null,
          "relationshipGoal": null,
          "city": "SJ",
          "distanceText": "1 mile away",
          "photos": [],
          "interests": [],
          "explanation": { "summary": "x", "keys": [] },
          "recentlyActive": true
        }
        """.data(using: .utf8)!
        let card = try JSONDecoder().decode(DeckCardDTO.self, from: json)
        XCTAssertEqual(card.recentlyActive, true)

        let model = ProfileCardModel(from: card)
        XCTAssertTrue(model.recentlyActive)
    }

    func testDeckCardDefaultsRecentlyActiveToFalseWhenMissing() throws {
        // Older servers without DISC-Q4 don't emit the field. iOS must
        // gracefully treat the absence as "don't render the badge".
        let json = """
        {
          "profileId": "p1",
          "userId": "u1",
          "displayName": "Sam",
          "bio": "",
          "gender": null,
          "pronouns": null,
          "relationshipGoal": null,
          "city": null,
          "distanceText": "Nearby",
          "photos": [],
          "interests": [],
          "explanation": { "summary": "", "keys": [] }
        }
        """.data(using: .utf8)!
        let card = try JSONDecoder().decode(DeckCardDTO.self, from: json)
        XCTAssertNil(card.recentlyActive)

        let model = ProfileCardModel(from: card)
        XCTAssertFalse(model.recentlyActive)
    }
}
