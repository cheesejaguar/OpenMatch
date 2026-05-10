import XCTest
@testable import OpenMatch

final class APIClientDecodingTests: XCTestCase {
    func testDeckResponseDecodesFromBackendShape() throws {
        let json = """
        {
          "deckSessionId": "ses_1",
          "algorithmVersion": "discovery-v1.0.0",
          "rankingConfigVersion": "2026-05-01",
          "cards": [
            {
              "profileId": "p1",
              "displayName": "Sam",
              "bio": "Hi there",
              "gender": "Man",
              "pronouns": "he/him",
              "relationshipGoal": "LongTerm",
              "city": "San Jose",
              "distanceText": "8 miles away",
              "photos": [
                {"id":"ph1","cdnUrl":"/media/seed.jpg","sortOrder":0,"blurhash":null}
              ],
              "interests": ["hiking","cooking"],
              "explanation": {
                "summary": "Within your distance range. Matches your selected gender preference.",
                "keys": ["withinDistance","mutualGenderPreference"]
              }
            }
          ]
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let deck = try decoder.decode(DeckResponseDTO.self, from: json)
        XCTAssertEqual(deck.cards.count, 1)
        XCTAssertEqual(deck.cards[0].profileId, "p1")
        XCTAssertEqual(deck.cards[0].photos.count, 1)
        XCTAssertEqual(deck.cards[0].distanceText, "8 miles away")
        XCTAssertEqual(deck.cards[0].explanation.keys.count, 2)
    }
}
