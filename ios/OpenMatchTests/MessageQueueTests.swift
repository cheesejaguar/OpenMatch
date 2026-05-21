import XCTest
@testable import OpenMatch

@MainActor
final class MessageQueueTests: XCTestCase {
    func testEnqueuePersists() {
        let storage = InMemoryMessageQueueStorage()
        let queue = MessageQueue(storage: storage, clock: FixedClock())
        let item = queue.enqueue(conversationId: "c1", body: "hi")

        XCTAssertEqual(queue.pending.count, 1)
        XCTAssertEqual(queue.pending.first?.id, item.id)
        XCTAssertEqual(storage.items.count, 1, "storage should be flushed on enqueue")
        XCTAssertEqual(storage.items.first?.body, "hi")
    }

    func testRestoresFromDiskOnInit() {
        let pre = PendingMessage(
            id: UUID(),
            conversationId: "c1",
            body: "stored",
            attempts: 1,
            lastError: "transient",
            sentAt: nil,
            nextAttemptAt: Date(timeIntervalSince1970: 0)
        )
        let storage = InMemoryMessageQueueStorage([pre])
        let queue = MessageQueue(storage: storage, clock: FixedClock())
        XCTAssertEqual(queue.pending.count, 1)
        XCTAssertEqual(queue.pending.first?.body, "stored")
    }

    func testAttemptDeliverSuccessRemovesItemAndNotifies() async {
        let storage = InMemoryMessageQueueStorage()
        let clock = FixedClock()
        let queue = MessageQueue(storage: storage, clock: clock)
        let sender = StubMessageSender()
        sender.behavior = .alwaysSucceed

        var delivered: [(UUID, MessageDTO)] = []
        queue.onDelivered = { id, dto in delivered.append((id, dto)) }

        let item = queue.enqueue(conversationId: "c1", body: "hi")
        await queue.attemptDeliver(api: sender)

        XCTAssertEqual(queue.pending.count, 0, "delivered messages should be drained")
        XCTAssertEqual(storage.items.count, 0, "storage should reflect drained queue")
        XCTAssertEqual(delivered.count, 1)
        XCTAssertEqual(delivered.first?.0, item.id)
        XCTAssertEqual(sender.callCount, 1)
    }

    func testAttemptDeliverDoesNotRetryDuringBackoffWindow() async {
        let clock = FixedClock()
        let storage = InMemoryMessageQueueStorage()
        let queue = MessageQueue(storage: storage, clock: clock)
        let sender = StubMessageSender()
        sender.behavior = .alwaysFail

        _ = queue.enqueue(conversationId: "c1", body: "hi")
        // First pass — fires once, fails, schedules next attempt at +2s.
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 1)
        XCTAssertEqual(queue.pending.first?.attempts, 1)

        // Same instant — backoff still active, should not fire again.
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 1, "still inside the 2s backoff window")

        // After 2 seconds elapse the row is due again.
        clock.advance(2)
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 2)
        XCTAssertEqual(queue.pending.first?.attempts, 2)
    }

    func testDiscardRemovesItemAndPersists() {
        let storage = InMemoryMessageQueueStorage()
        let queue = MessageQueue(storage: storage, clock: FixedClock())
        let item = queue.enqueue(conversationId: "c1", body: "hi")
        XCTAssertEqual(storage.items.count, 1)
        queue.discard(item.id)
        XCTAssertEqual(queue.pending.count, 0)
        XCTAssertEqual(storage.items.count, 0)
    }

    func testRetryResetsBackoffWindow() async {
        let clock = FixedClock()
        let queue = MessageQueue(storage: InMemoryMessageQueueStorage(), clock: clock)
        let sender = StubMessageSender()
        sender.behavior = .alwaysFail
        let item = queue.enqueue(conversationId: "c1", body: "hi")
        await queue.attemptDeliver(api: sender) // fail #1, next-at +2s
        XCTAssertEqual(sender.callCount, 1)

        // Without advancing the clock, the row is past-due after retry().
        queue.retry(item.id)
        await queue.attemptDeliver(api: sender)
        XCTAssertEqual(sender.callCount, 2)
    }

    func testFileStorageRoundTrip() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("openmatch-test-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let storage = FileMessageQueueStorage(url: tmp)
        let item = PendingMessage(
            id: UUID(),
            conversationId: "c1",
            body: "persist me",
            attempts: 2,
            lastError: "boom",
            sentAt: nil,
            nextAttemptAt: Date(timeIntervalSince1970: 1700000000)
        )
        storage.save([item])
        // PERF-I13 — File writes are dispatched off the main thread.
        // Block until the background queue has drained before asserting
        // on the on-disk bytes.
        storage._flushForTesting()
        let reloaded = storage.load()
        XCTAssertEqual(reloaded.count, 1)
        XCTAssertEqual(reloaded.first, item)
    }
}
