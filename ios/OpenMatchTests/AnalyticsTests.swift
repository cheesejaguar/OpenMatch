import XCTest
@testable import OpenMatch

final class AnalyticsTests: XCTestCase {
    func testAnalyticsValueCodecRoundTrips() throws {
        let cases: [AnalyticsValue] = [
            .string("hello"),
            .int(42),
            .double(3.14),
            .bool(true),
            .bool(false),
            .int(0),
        ]
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        for v in cases {
            let data = try encoder.encode(v)
            let decoded = try decoder.decode(AnalyticsValue.self, from: data)
            XCTAssertEqual(v, decoded, "AnalyticsValue \(v) did not round-trip")
        }
    }

    func testAnalyticsEventEncodesAsObject() throws {
        let event = AnalyticsEvent(
            name: "signup.email_started",
            properties: ["email_domain": .s("example.com"), "n": .i(1)],
            clientTs: Date(timeIntervalSince1970: 1700000000)
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(event)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNotNil(obj)
        XCTAssertEqual(obj?["name"] as? String, "signup.email_started")
        let props = obj?["properties"] as? [String: Any]
        XCTAssertEqual(props?["email_domain"] as? String, "example.com")
        XCTAssertEqual(props?["n"] as? Int, 1)
    }

    func testAnalyticsValueRejectsUnsupportedJSON() {
        let data = "[1,2,3]".data(using: .utf8)!
        XCTAssertThrowsError(try JSONDecoder().decode(AnalyticsValue.self, from: data))
    }

    func testAnalyticsRecordBuffersUntilFlush() async {
        let actor = Analytics.shared
        // Buffer should start empty in a fresh test session, but other
        // tests may have left state. Drain first.
        _ = await actor.flush()
        let before = await actor.currentBufferCount()
        // Record a single event — without an attached API client, the
        // flush task can't send. The buffer should still be empty
        // after a forced flush because flush() only drops on failure
        // when api is non-nil. With nil api, currentBufferCount stays
        // equal to what we recorded (until a real api is attached).
        await actor.record("test.event_a")
        let mid = await actor.currentBufferCount()
        XCTAssertEqual(mid, before + 1)
        // With no api attached, flush() returns the buffer count
        // without clearing it.
        let flushed = await actor.flush()
        XCTAssertEqual(flushed, mid)
    }
}
