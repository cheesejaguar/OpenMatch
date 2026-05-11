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
        realtime?.close()
        realtime = nil
    }

    // Subscribe to live messages on `conversation:{id}`. The handler is
    // invoked on the main actor with the decoded MessageDTO when the
    // backend publishes after a successful POST /messages.
    @discardableResult
    func subscribe(
        conversationId: String,
        onMessage: @escaping (MessageDTO) -> Void
    ) -> RealtimeSubscription {
        guard let channel = realtime?.channels.get("conversation:\(conversationId)") else {
            return RealtimeSubscription(channel: nil, listener: nil)
        }
        let listener = channel.subscribe("message") { artMessage in
            guard let payload = artMessage.data as? [String: Any],
                  let inner = payload["payload"] as? [String: Any] else {
                return
            }
            // Re-serialize through JSONSerialization → Data so we can let
            // JSONDecoder do the work (Ably hands us [String: Any], not Data).
            guard let data = try? JSONSerialization.data(withJSONObject: inner),
                  let dto = try? Self.jsonDecoder.decode(MessageDTO.self, from: data) else {
                return
            }
            Task { @MainActor in onMessage(dto) }
        }
        return RealtimeSubscription(channel: channel, listener: listener)
    }

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
// channel listener and stop receiving events. Cancellation is idempotent.
final class RealtimeSubscription {
    private weak var channel: ARTRealtimeChannel?
    private var listener: ARTEventListener?

    init(channel: ARTRealtimeChannel?, listener: ARTEventListener?) {
        self.channel = channel
        self.listener = listener
    }

    func cancel() {
        if let listener {
            channel?.unsubscribe(listener)
        }
        listener = nil
    }

    deinit { cancel() }
}
