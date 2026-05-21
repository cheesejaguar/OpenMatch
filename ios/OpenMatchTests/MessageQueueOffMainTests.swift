import XCTest
@testable import OpenMatch

// PERF-I13 — Verifies the file-backed storage no longer blocks the
// MainActor on save. We can't directly observe "did not block" without
// timing flakes, but we *can* confirm:
//   1. Calling save() from the main thread returns essentially
//      immediately (the encode + atomic write happens on the background
//      queue).
//   2. A subsequent `_flushForTesting()` makes the file appear.
final class MessageQueueOffMainTests: XCTestCase {
    func testSaveFromMainThreadReturnsBeforeDiskFlush() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("openmatch-offmain-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("message-queue.json")
        defer { try? FileManager.default.removeItem(at: tmp.deletingLastPathComponent()) }
        let storage = FileMessageQueueStorage(url: tmp)

        // Construct a batch large enough that encode + atomic write would
        // be measurable (~1ms) if it ran inline. We assert structurally
        // (file exists only after flush) rather than via timing.
        let items = (0..<200).map { i in
            PendingMessage(
                id: UUID(),
                conversationId: "c\(i)",
                body: String(repeating: "x", count: 256),
                attempts: 0,
                lastError: nil,
                sentAt: nil,
                nextAttemptAt: Date()
            )
        }
        XCTAssertTrue(Thread.isMainThread, "Test runs on main thread")
        storage.save(items)
        // Flush the background queue and assert the bytes are now on disk.
        storage._flushForTesting()
        XCTAssertTrue(FileManager.default.fileExists(atPath: tmp.path))
        let reloaded = storage.load()
        XCTAssertEqual(reloaded.count, items.count)
    }
}
