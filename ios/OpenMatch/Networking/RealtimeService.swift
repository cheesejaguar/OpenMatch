import Ably
import Foundation

// Realtime fan-out for chat, backed by Ably. The server is the source of
// truth for capability — every TokenRequest is signed for the caller's
// active conversations only. iOS uses authCallback so we can route token
// requests through APIClient (which owns access-token rotation) instead
// of letting Ably's own HTTP machinery hit our endpoint.
//
// Lifecycle:
// - `connect(api:)` is called once a user is signed in.
// - `subscribe(conversationId:onMessage:)` attaches a handler for incoming
//   messages on `conversation:{id}` and returns a Cancellable token.
// - `disconnect()` closes everything; called on sign-out.

@MainActor
final class RealtimeService: ObservableObject {
    static let shared = RealtimeService()

    private var realtime: ARTRealtime?
    private weak var api: APIClient?

    private init() {}

    func connect(api: APIClient) {
        self.api = api
        if realtime != nil { return }

        let options = ARTClientOptions()
        options.autoConnect = true
        // authCallback is invoked by the SDK whenever it needs a new token,
        // both for the initial auth and on renewal near token expiry.
        options.authCallback = { [weak self] _, callback in
            guard let self else {
                callback(nil, NSError(domain: "OpenMatch.Realtime", code: -1))
                return
            }
            Task { @MainActor in
                guard let api = self.api else {
                    callback(nil, NSError(domain: "OpenMatch.Realtime", code: -2))
                    return
                }
                do {
                    let dto = try await api.realtimeToken()
                    let tokenRequest = Self.makeTokenRequest(from: dto)
                    callback(tokenRequest, nil)
                } catch {
                    callback(nil, error as NSError)
                }
            }
        }

        realtime = ARTRealtime(options: options)
    }

    func disconnect() {
        // Closing the Ably client detaches every attached channel and
        // releases the underlying transport. Calling close() on a nil
        // realtime is a no-op (idempotent), so a background → background
        // double tap (e.g. scenePhase debounce) is safe.
        realtime?.close()
        realtime = nil
    }

    // Test/debug helper: reports whether we currently hold an open Ably
    // client. Used by ScenePhaseHandlerTests to verify background/active
    // toggles the underlying socket.
    var isConnected: Bool { realtime != nil }

    // Subscribe to live messages on `conversation:{id}`. The handler is
    // invoked on the main actor with the decoded MessageDTO when the
    // backend publishes after a successful POST /messages.
    @discardableResult
    func subscribe(
        conversationId: String,
        onMessage: @escaping (MessageDTO) -> Void,
        onTyping: ((TypingEvent) -> Void)? = nil,
        onRead: ((ReadEvent) -> Void)? = nil,
        onReaction: ((ReactionEvent) -> Void)? = nil
    ) -> RealtimeSubscription {
        guard let channel = realtime?.channels.get("conversation:\(conversationId)") else {
            return RealtimeSubscription(channel: nil, listeners: [])
        }
        var listeners: [ARTEventListener] = []
        let messageListener = channel.subscribe("message") { artMessage in
            guard let payload = artMessage.data as? [String: Any],
                  let inner = payload["payload"] as? [String: Any] else {
                return
            }
            guard let data = try? JSONSerialization.data(withJSONObject: inner),
                  let dto = try? Self.jsonDecoder.decode(MessageDTO.self, from: data) else {
                return
            }
            Task { @MainActor in onMessage(dto) }
        }
        if let messageListener { listeners.append(messageListener) }

        if let onTyping {
            let typingListener = channel.subscribe("typing") { artMessage in
                guard let payload = artMessage.data as? [String: Any],
                      let userId = payload["userId"] as? String else {
                    return
                }
                let ts = (payload["ts"] as? Double) ?? Date().timeIntervalSince1970 * 1000
                let event = TypingEvent(userId: userId, timestamp: ts / 1000.0)
                Task { @MainActor in onTyping(event) }
            }
            if let typingListener { listeners.append(typingListener) }
        }

        if let onRead {
            let readListener = channel.subscribe("read") { artMessage in
                guard let payload = artMessage.data as? [String: Any],
                      let readerUserId = payload["readerUserId"] as? String else {
                    return
                }
                let isoString = payload["readAt"] as? String
                let readAt = isoString.flatMap { Self.iso8601.date(from: $0) } ?? Date()
                let event = ReadEvent(
                    readerUserId: readerUserId,
                    readAt: readAt,
                    messageId: payload["messageId"] as? String
                )
                Task { @MainActor in onRead(event) }
            }
            if let readListener { listeners.append(readListener) }
        }

        if let onReaction {
            for name in ["reaction.added", "reaction.removed"] {
                let removed = name == "reaction.removed"
                let listener = channel.subscribe(name) { artMessage in
                    guard let payload = artMessage.data as? [String: Any],
                          let messageId = payload["messageId"] as? String,
                          let userId = payload["userId"] as? String,
                          let emoji = payload["emoji"] as? String else {
                        return
                    }
                    let evt = ReactionEvent(
                        messageId: messageId,
                        userId: userId,
                        emoji: emoji,
                        removed: removed
                    )
                    Task { @MainActor in onReaction(evt) }
                }
                if let listener { listeners.append(listener) }
            }
        }

        return RealtimeSubscription(channel: channel, listeners: listeners)
    }

    // Best-effort typing-event publisher. Drops silently if Ably isn't
    // connected — typing events are ephemeral; a missed publish has no
    // user-visible consequence beyond a momentarily-missing indicator.
    func publishTyping(conversationId: String, userId: String) {
        guard let channel = realtime?.channels.get("conversation:\(conversationId)") else { return }
        let payload: [String: Any] = [
            "userId": userId,
            "ts": Date().timeIntervalSince1970 * 1000,
        ]
        channel.publish("typing", data: payload)
    }

    private static let iso8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    // MARK: - Helpers

    private static let jsonDecoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private static func makeTokenRequest(from dto: AblyTokenRequestDTO) -> ARTTokenRequest {
        let params = ARTTokenParams(clientId: dto.clientId)
        params.capability = dto.capability
        if let ttl = dto.ttl {
            params.ttl = NSNumber(value: ttl / 1000) // Ably TTL is seconds; backend sends ms.
        }
        params.timestamp = Date(timeIntervalSince1970: TimeInterval(dto.timestamp) / 1000.0)
        return ARTTokenRequest(
            tokenParams: params,
            keyName: dto.keyName,
            nonce: dto.nonce,
            mac: dto.mac
        )
    }
}

// Returned from `subscribe`. Drop it (or call `cancel()`) to detach the
// channel listeners and stop receiving events. Cancellation is idempotent.
//
// Multi-listener now: subscribing a single conversation can attach
// listeners for "message" + "typing" + "read" + "reaction.*" — we
// bundle them under one Subscription so the view can cancel atomically.
final class RealtimeSubscription {
    private weak var channel: ARTRealtimeChannel?
    private var listeners: [ARTEventListener]

    init(channel: ARTRealtimeChannel?, listeners: [ARTEventListener]) {
        self.channel = channel
        self.listeners = listeners
    }

    func cancel() {
        for listener in listeners {
            channel?.unsubscribe(listener)
        }
        listeners = []
    }

    deinit { cancel() }
}

// Typed payloads handed to the view-model subscribers.

struct TypingEvent {
    let userId: String
    let timestamp: TimeInterval
}

struct ReadEvent {
    let readerUserId: String
    let readAt: Date
    let messageId: String?
}

struct ReactionEvent {
    let messageId: String
    let userId: String
    let emoji: String
    let removed: Bool
}
