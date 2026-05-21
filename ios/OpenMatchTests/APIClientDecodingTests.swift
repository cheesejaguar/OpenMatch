import XCTest
@testable import OpenMatch

final class APIClientDecodingTests: XCTestCase {

    // The new chat fields (deliveredAt, readAt, audioPath, audioDurationMs,
    // reactions) are decoded `IfPresent` so an older backend build that
    // hasn't shipped the columns yet still decodes cleanly without
    // crashing the chat list view.
    func testMessageDTODecodesLegacyShape() throws {
        let json = """
        {
          "id":"m1",
          "conversationId":"c1",
          "senderUserId":"u1",
          "body":"hi",
          "createdAt":"2026-05-21T10:00:00Z"
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let m = try decoder.decode(MessageDTO.self, from: json)
        XCTAssertEqual(m.id, "m1")
        XCTAssertEqual(m.body, "hi")
        XCTAssertNil(m.deliveredAt)
        XCTAssertNil(m.readAt)
        XCTAssertNil(m.audioPath)
        XCTAssertTrue(m.reactions.isEmpty)
    }

    func testMessageDTODecodesFullShape() throws {
        let json = """
        {
          "id":"m1",
          "conversationId":"c1",
          "senderUserId":"u1",
          "body":"",
          "createdAt":"2026-05-21T10:00:00Z",
          "deliveredAt":"2026-05-21T10:00:01Z",
          "readAt":"2026-05-21T10:00:05Z",
          "audioPath":"conversations/c1/audio/x.m4a",
          "audioDurationMs":3500,
          "reactions":[
            {"userId":"u2","emoji":"🔥","createdAt":"2026-05-21T10:00:10Z"}
          ]
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let m = try decoder.decode(MessageDTO.self, from: json)
        XCTAssertNotNil(m.deliveredAt)
        XCTAssertNotNil(m.readAt)
        XCTAssertEqual(m.audioDurationMs, 3500)
        XCTAssertEqual(m.reactions.count, 1)
        XCTAssertEqual(m.reactions.first?.emoji, "🔥")
    }

    func testDeckResponseDecodesFromBackendShape() throws {
        let json = """
        {
          "deckSessionId": "ses_1",
          "algorithmVersion": "discovery-v1.0.0",
          "rankingConfigVersion": "2026-05-01",
          "cards": [
            {
              "profileId": "p1",
              "userId": "u1",
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
