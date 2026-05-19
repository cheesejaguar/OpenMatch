import XCTest
@testable import OpenMatch

@MainActor
final class MessageQueueRetryTests: XCTestCase {
    // Fails twice then succeeds. Verifies the queue:
    //   - bumps `attempts` on each failure
    //   - respects the 0/2/8/30 backoff schedule
    //   - drains the row on eventual success
    //   - persists state after every transition
    func testRetriesUntilSuccessRespectingBackoff() async {
        let clock = FixedClock()
        let storage = InMemoryMessageQueueStorage()
        let queue = MessageQueue(storage: storage, clock: clock)
        let sender = StubMessageSender()
        sender.behavior = .failNTimesThenSucceed(2)

        let item = queue.enqueue(conversationId: "c1", body: "hi")

        // Attempt 0 — immediate. Fails (call #1).
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 1)
        XCTAssertEqual(queue.pending.first?.attempts, 1)
        XCTAssertNotNil(queue.pending.first?.lastError)

        // Inside the 2s window — no fire.
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 1, "must respect 2s backoff")

        // +2s: due again. Fails (call #2).
        clock.advance(2)
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 2)
        XCTAssertEqual(queue.pending.first?.attempts, 2)

        // Inside the 8s window — no fire.
        clock.advance(4)
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 2, "must respect 8s backoff")

        // +8s after attempt 2 means we need 8 total since the last try.
        clock.advance(4) // total 8s since fail #2
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 3)
        // Succeeded on attempt 3.
        XCTAssertEqual(queue.pending.count, 0, "row should be drained on success")
        XCTAssertEqual(storage.items.count, 0)
    }

    func testDropsAfterMaxAttemptsAndNotifies() async {
        let clock = FixedClock()
        let storage = InMemoryMessageQueueStorage()
        let queue = MessageQueue(storage: storage, clock: clock)
        let sender = StubMessageSender()
        sender.behavior = .alwaysFail

        var dropped: [PendingMessage] = []
        queue.onPermanentFailure = { dropped.append($0) }

        _ = queue.enqueue(conversationId: "c1", body: "hi")

        // Drive the 4 attempts via the documented 0/2/8/30 schedule.
        await queue.attemptDeliver(api: sender) // #1 attempts → 1
        clock.advance(2)
        await queue.attemptDeliver(api: sender) // #2 attempts → 2
        clock.advance(8)
        await queue.attemptDeliver(api: sender) // #3 attempts → 3
        clock.advance(30)
        await queue.attemptDeliver(api: sender) // #4 attempts → 4 → drop

        XCTAssertEqual(sender.callCount, 4)
        XCTAssertEqual(queue.pending.count, 0, "dropped after maxAttempts")
        XCTAssertEqual(storage.items.count, 0, "drop is persisted")
        XCTAssertEqual(dropped.count, 1)
        XCTAssertEqual(dropped.first?.attempts, 4)
    }
}
