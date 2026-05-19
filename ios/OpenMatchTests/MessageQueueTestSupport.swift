import Foundation
@testable import OpenMatch

// Shared helpers for MessageQueue tests. Kept out of the main target so
// production code can't accidentally depend on them.

final class FixedClock: MessageQueueClock {
    var current: Date
    init(_ start: Date = Date(timeIntervalSince1970: 1_700_000_000)) {
        self.current = start
    }
    func now() -> Date { current }
    func advance(_ seconds: TimeInterval) {
        current = current.addingTimeInterval(seconds)
    }
}

// Drives MessageQueue with deterministic success/failure sequences. We
// don't go through URLSession here — the MessageSending protocol is the
// seam, so we can replay scenarios without intercepting network IO.
@MainActor
final class StubMessageSender: MessageSending {
    enum Behavior {
        case alwaysSucceed
        case alwaysFail
        case failNTimesThenSucceed(Int)
    }

    var behavior: Behavior = .alwaysSucceed
    private(set) var callCount = 0
    private(set) var lastConversationId: String?
    private(set) var lastBody: String?

    func sendMessage(conversationId: String, body: String) async throws -> MessageDTO {
        callCount += 1
        lastConversationId = conversationId
        lastBody = body
        switch behavior {
        case .alwaysSucceed:
            return Self.makeDTO(conversationId: conversationId, body: body)
        case .alwaysFail:
            throw APIError.http(status: 503, message: "stub failure")
        case .failNTimesThenSucceed(let n):
            if callCount <= n {
                throw APIError.http(status: 503, message: "stub failure")
            }
            return Self.makeDTO(conversationId: conversationId, body: body)
        }
    }

    private static func makeDTO(conversationId: String, body: String) -> MessageDTO {
        // Deterministic-ish id derived from the call. Doesn't need to be
        // a real ULID — callers only compare identity.
        MessageDTO(
            id: "m-\(UUID().uuidString.prefix(8))",
            conversationId: conversationId,
            senderUserId: "u-me",
            body: body,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }
}
