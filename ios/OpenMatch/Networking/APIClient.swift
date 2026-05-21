import Foundation
import UIKit
#if canImport(Sentry)
import Sentry
#endif

// Round D — iOS network observability.
//
// Every outbound HTTP request is wrapped in a Sentry performance span
// keyed by HTTP path so the Sentry SDK can attribute backend latency
// to the calling iOS screen. Transport errors (DNS, connection refused,
// TLS) and 5xx responses additionally feed `Crash.capture(...)` so
// they show up as Sentry events even when the user retries before the
// app crashes. 4xx errors stay silent — they're expected user-facing
// errors (invalid invite code, rate limit, etc.).

@inline(__always)
private func omRunWithHTTPSpan<T>(_ path: String, _ work: () async throws -> T) async rethrows -> T {
    #if canImport(Sentry)
    // Guard against lazy hub initialisation when SentrySDK was never
    // started (e.g. test target, or production builds with an empty
    // `SentryDSN` Info.plist value). Calling `startTransaction` on an
    // unstarted SDK constructs a default hub on whatever queue we're on,
    // which in turn reads `UIApplication.applicationState` off the main
    // thread and trips Main Thread Checker — crashing the test process
    // with signal abrt before any test case can run.
    guard Crash.isReporting else {
        return try await work()
    }
    let span = SentrySDK.startTransaction(name: path, operation: "http.client")
    defer { span.finish() }
    return try await work()
    #else
    return try await work()
    #endif
}

// Round B — typed error cases mirroring the backend ErrorCodes registry
// in `backend/src/lib/error-codes.ts`. Every code the server emits has a
// dedicated case so call sites pattern-match the failure mode instead of
// substring-matching opaque JSON. Payload-bearing codes (outside_metro,
// country_not_supported, validation_failed) carry their extra fields
// directly on the case.
enum APIError: Error, LocalizedError, Equatable {
    case notAuthenticated
    case transport(Error)
    case decoding(String)
    case validation(fields: [APIValidationField])
    case rateLimited

    // Auth / 2FA
    case emailRequired
    case emailInvalid
    case challengeNotFound
    case challengeExpired
    case challengeUsed
    case tokenMismatch
    case refreshTokenInvalid
    case refreshTokenReused
    case devLoginDisabled
    case devUserIdRequired
    case appleNotConfigured
    case appleIdentityTokenRequired
    case appleVerificationFailed
    case twoFactorRequired
    case totpInvalid
    case recoveryCodeInvalid
    case totpNotEnrolled

    // Beta gates
    case inviteRequired
    case inviteInvalid
    case inviteExhausted
    case inviteExpired
    case inviteRevoked
    case signupsPaused
    case outsideMetro(nearestKm: Double?)
    case countryNotSupported(reason: String?, note: String?)

    // Profile / photos
    case underage
    case invalidDob
    case profileNotFound
    case maxPhotosReached
    case noFile
    case unsupportedMediaType
    case payloadTooLarge
    case photoNotFound
    case photoNotOwned
    case duplicatePhotos
    case minAgeAboveMax

    // Swipe / match / chat
    case targetNotFound
    case undoNotAvailable
    case matchNotFound
    case conversationNotFound
    case notParticipant
    case userBlocked
    case alreadyBlocked

    // Realtime / safety / admin / internal
    case realtimeUnconfigured
    case reportNotFound
    case dsaNoticeNotFound
    case adminForbidden
    case adminRbacDenied
    case adminUserNotFound
    case adminActionInvalid

    // Catch-alls
    case userNotFound
    case conflict
    case notFound
    case unauthorized
    case forbidden
    case unknown(code: String, status: Int, message: String?)

    // Generic HTTP error with no parseable code body. Preserved as a
    // fallback so non-JSON responses (HTML error pages from a proxy,
    // truncated streams) still surface a status code to the UI.
    case http(status: Int, message: String?)

    var errorDescription: String? {
        let key = "error.\(localizationKey)"
        // Look up a localised string. If we don't ship one for this case,
        // fall back to a generic message rather than the raw key.
        let localised = NSLocalizedString(key, tableName: "ErrorMessages", bundle: .main, comment: "")
        if localised != key {
            switch self {
            case .outsideMetro(let km):
                if let km = km {
                    return String(format: localised, km)
                }
                return localised
            case .countryNotSupported(let reason, let note):
                if let note = note, !note.isEmpty {
                    return note
                }
                if let reason = reason, !reason.isEmpty {
                    return String(format: localised, reason)
                }
                return localised
            case .transport(let err):
                return localised.isEmpty ? err.localizedDescription : localised
            case .http(let status, let msg):
                return String(format: localised, status, msg ?? "")
            case .unknown(let code, _, let msg):
                if let msg = msg, !msg.isEmpty { return msg }
                return String(format: localised, code)
            case .validation(let fields):
                if let first = fields.first {
                    return "\(first.path): \(first.message)"
                }
                return localised
            default:
                return localised
            }
        }
        // Fallback when no .strings file is bundled (tests, previews).
        switch self {
        case .notAuthenticated: return "You're not signed in."
        case .transport(let err): return err.localizedDescription
        case .decoding(let msg): return "Decoding error: \(msg)"
        case .http(let status, let msg): return "HTTP \(status)\(msg.map { ": \($0)" } ?? "")"
        case .unknown(let code, _, let msg):
            return msg ?? "Something went wrong (\(code))."
        case .validation(let fields):
            return fields.first.map { "\($0.path): \($0.message)" } ?? "Some fields are invalid."
        default:
            return "Something went wrong."
        }
    }

    // Stable identifier used to look up a localised message. Keep in
    // sync with ErrorMessages.strings keys.
    private var localizationKey: String {
        switch self {
        case .notAuthenticated: return "not_authenticated"
        case .transport: return "transport"
        case .decoding: return "decoding"
        case .validation: return "validation_failed"
        case .rateLimited: return "rate_limited"
        case .emailRequired: return "email_required"
        case .emailInvalid: return "email_invalid"
        case .challengeNotFound: return "challenge_not_found"
        case .challengeExpired: return "challenge_expired"
        case .challengeUsed: return "challenge_used"
        case .tokenMismatch: return "token_mismatch"
        case .refreshTokenInvalid: return "refresh_token_invalid"
        case .refreshTokenReused: return "refresh_token_reused"
        case .devLoginDisabled: return "dev_login_disabled"
        case .devUserIdRequired: return "dev_user_id_required"
        case .appleNotConfigured: return "apple_not_configured"
        case .appleIdentityTokenRequired: return "apple_identity_token_required"
        case .appleVerificationFailed: return "apple_verification_failed"
        case .twoFactorRequired: return "two_factor_required"
        case .totpInvalid: return "totp_invalid"
        case .recoveryCodeInvalid: return "recovery_code_invalid"
        case .totpNotEnrolled: return "totp_not_enrolled"
        case .inviteRequired: return "invite_required"
        case .inviteInvalid: return "invite_invalid"
        case .inviteExhausted: return "invite_exhausted"
        case .inviteExpired: return "invite_expired"
        case .inviteRevoked: return "invite_revoked"
        case .signupsPaused: return "signups_paused"
        case .outsideMetro: return "outside_metro"
        case .countryNotSupported: return "country_not_supported"
        case .underage: return "underage"
        case .invalidDob: return "invalid_dob"
        case .profileNotFound: return "profile_not_found"
        case .maxPhotosReached: return "max_photos_reached"
        case .noFile: return "no_file"
        case .unsupportedMediaType: return "unsupported_media_type"
        case .payloadTooLarge: return "payload_too_large"
        case .photoNotFound: return "photo_not_found"
        case .photoNotOwned: return "photo_not_owned"
        case .duplicatePhotos: return "duplicate_photos"
        case .minAgeAboveMax: return "min_age_above_max"
        case .targetNotFound: return "target_not_found"
        case .undoNotAvailable: return "undo_not_available"
        case .matchNotFound: return "match_not_found"
        case .conversationNotFound: return "conversation_not_found"
        case .notParticipant: return "not_participant"
        case .userBlocked: return "user_blocked"
        case .alreadyBlocked: return "already_blocked"
        case .realtimeUnconfigured: return "realtime_unconfigured"
        case .reportNotFound: return "report_not_found"
        case .dsaNoticeNotFound: return "dsa_notice_not_found"
        case .adminForbidden: return "admin_forbidden"
        case .adminRbacDenied: return "admin_rbac_denied"
        case .adminUserNotFound: return "admin_user_not_found"
        case .adminActionInvalid: return "admin_action_invalid"
        case .userNotFound: return "user_not_found"
        case .conflict: return "conflict"
        case .notFound: return "not_found"
        case .unauthorized: return "unauthorized"
        case .forbidden: return "forbidden"
        case .unknown: return "unknown"
        case .http: return "http"
        }
    }

    static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.notAuthenticated, .notAuthenticated),
             (.rateLimited, .rateLimited),
             (.emailRequired, .emailRequired),
             (.emailInvalid, .emailInvalid),
             (.challengeNotFound, .challengeNotFound),
             (.challengeExpired, .challengeExpired),
             (.challengeUsed, .challengeUsed),
             (.tokenMismatch, .tokenMismatch),
             (.refreshTokenInvalid, .refreshTokenInvalid),
             (.refreshTokenReused, .refreshTokenReused),
             (.devLoginDisabled, .devLoginDisabled),
             (.devUserIdRequired, .devUserIdRequired),
             (.appleNotConfigured, .appleNotConfigured),
             (.appleIdentityTokenRequired, .appleIdentityTokenRequired),
             (.appleVerificationFailed, .appleVerificationFailed),
             (.twoFactorRequired, .twoFactorRequired),
             (.totpInvalid, .totpInvalid),
             (.recoveryCodeInvalid, .recoveryCodeInvalid),
             (.totpNotEnrolled, .totpNotEnrolled),
             (.inviteRequired, .inviteRequired),
             (.inviteInvalid, .inviteInvalid),
             (.inviteExhausted, .inviteExhausted),
             (.inviteExpired, .inviteExpired),
             (.inviteRevoked, .inviteRevoked),
             (.signupsPaused, .signupsPaused),
             (.underage, .underage),
             (.invalidDob, .invalidDob),
             (.profileNotFound, .profileNotFound),
             (.maxPhotosReached, .maxPhotosReached),
             (.noFile, .noFile),
             (.unsupportedMediaType, .unsupportedMediaType),
             (.payloadTooLarge, .payloadTooLarge),
             (.photoNotFound, .photoNotFound),
             (.photoNotOwned, .photoNotOwned),
             (.duplicatePhotos, .duplicatePhotos),
             (.minAgeAboveMax, .minAgeAboveMax),
             (.targetNotFound, .targetNotFound),
             (.undoNotAvailable, .undoNotAvailable),
             (.matchNotFound, .matchNotFound),
             (.conversationNotFound, .conversationNotFound),
             (.notParticipant, .notParticipant),
             (.userBlocked, .userBlocked),
             (.alreadyBlocked, .alreadyBlocked),
             (.realtimeUnconfigured, .realtimeUnconfigured),
             (.reportNotFound, .reportNotFound),
             (.dsaNoticeNotFound, .dsaNoticeNotFound),
             (.adminForbidden, .adminForbidden),
             (.adminRbacDenied, .adminRbacDenied),
             (.adminUserNotFound, .adminUserNotFound),
             (.adminActionInvalid, .adminActionInvalid),
             (.userNotFound, .userNotFound),
             (.conflict, .conflict),
             (.notFound, .notFound),
             (.unauthorized, .unauthorized),
             (.forbidden, .forbidden):
            return true
        case (.transport(let l), .transport(let r)):
            return (l as NSError).domain == (r as NSError).domain &&
                (l as NSError).code == (r as NSError).code
        case (.decoding(let l), .decoding(let r)):
            return l == r
        case (.validation(let l), .validation(let r)):
            return l == r
        case (.outsideMetro(let l), .outsideMetro(let r)):
            return l == r
        case (.countryNotSupported(let lr, let ln), .countryNotSupported(let rr, let rn)):
            return lr == rr && ln == rn
        case (.unknown(let lc, let ls, let lm), .unknown(let rc, let rs, let rm)):
            return lc == rc && ls == rs && lm == rm
        case (.http(let ls, let lm), .http(let rs, let rm)):
            return ls == rs && lm == rm
        default:
            return false
        }
    }
}


@MainActor
final class APIClient: ObservableObject {
    let baseURL: URL
    @Published private(set) var hasSession: Bool
    private(set) var cachedUserId: String?

    // PERF — Shared coders. The previous design allocated a new
    // JSONDecoder + JSONEncoder per APIClient instance (and we
    // instantiate APIClient from several SwiftUI surfaces — root
    // AppState, AlgorithmView, LikesView, tests). The decoders carry
    // their own internal date-parsing caches and configuration objects
    // that are pointless to rebuild; making them static lets every
    // request reuse the same warmed-up instances. They're immutable
    // after first access so concurrent use is safe.
    fileprivate static let sharedDecoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
    fileprivate static let sharedEncoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private let session: URLSession
    // SEV-M2 — Strong-held reference to the pinning delegate. URLSession
    // also retains it, but keeping a property makes the lifetime explicit
    // and lets tests reach in to verify the delegate was installed.
    private let pinningDelegate: PinningSessionDelegate
    private var decoder: JSONDecoder { APIClient.sharedDecoder }
    private var encoder: JSONEncoder { APIClient.sharedEncoder }
    private var accessToken: String?
    private var refreshToken: String?

    // Concurrent 401s in a busy UI must not fire N parallel /refresh calls.
    // Coalesce into a single in-flight refresh task per APIClient.
    private var refreshTask: Task<Bool, Never>?

    // PERF-I3 — Track every APIClient construction in DEBUG so a regression
    // that re-introduces a per-feature client (e.g. `APIClient(baseURL:)`
    // inside a SwiftUI view's `@StateObject` initializer) trips an
    // assertion the first time the second instance is built for the same
    // host. The shared client lives on `AppState`; everywhere else should
    // be injected via `@EnvironmentObject`.
    #if DEBUG
    private static let instanceCountLock = NSLock()
    nonisolated(unsafe) private static var instanceCountByHost: [String: Int] = [:]
    #endif

    init(baseURL: URL) {
        self.baseURL = baseURL
        #if DEBUG
        Self.instanceCountLock.lock()
        let host = baseURL.host ?? baseURL.absoluteString
        let count = (Self.instanceCountByHost[host] ?? 0) + 1
        Self.instanceCountByHost[host] = count
        Self.instanceCountLock.unlock()
        // First duplicate is the canary: any second instance for the same
        // host is almost certainly a feature view bypassing `appState.api`.
        // Tests intentionally construct multiple clients (every XCTestCase
        // builds its own); skip the assertion under XCTest by sniffing the
        // bundle.
        let isUnderXCTest = NSClassFromString("XCTestCase") != nil
        if count > 1 && !isUnderXCTest {
            assertionFailure(
                "APIClient initialized \(count)× for host \(host). " +
                "Use AppState.api / @EnvironmentObject APIClient instead of " +
                "constructing a new client inside a view (see PERF-I3)."
            )
        }
        #endif
        let cfg = URLSessionConfiguration.default
        // PERF — explicit network tuning that previously relied on
        // defaults.
        //   * `waitsForConnectivity` keeps tasks queued through a brief
        //     flap instead of failing fast — a UX win for spotty
        //     networks and a no-op on stable ones.
        //   * `httpMaximumConnectionsPerHost` is set explicitly to the
        //     iOS default (6) so future tuning is local to this file.
        //   * `requestCachePolicy = .useProtocolCachePolicy` honours
        //     the backend's `Cache-Control` directives end-to-end.
        //   * `urlCache` is a dedicated 16MB / 128MB cache so cacheable
        //     GETs (e.g. `/profile/:id`) actually land in a private
        //     URLCache instead of fighting with WebKit's shared one.
        cfg.waitsForConnectivity = true
        cfg.httpMaximumConnectionsPerHost = 6
        cfg.requestCachePolicy = .useProtocolCachePolicy
        cfg.urlCache = APIClient.sharedURLCache
        #if DEBUG
        // Local dev runs the simulator against the country gate without
        // any edge headers. Announce a supported country so /auth/start
        // doesn't 451. Production requests are tagged by Vercel/Cloudflare.
        cfg.httpAdditionalHeaders = ["x-openmatch-country": "US"]
        #endif
        // SEV-M2 — Install the SPKI pinning delegate. The delegate
        // is a no-op when `OMBackendSPKIPins` in Info.plist is empty
        // (default for Wave 2 — see `doc/security/cert-pinning-design.md`).
        // When pins are configured it rejects any TLS chain whose leaf
        // SPKI hash isn't in the pin list, even if system trust accepts
        // the chain.
        let delegate = PinningSessionDelegate()
        self.pinningDelegate = delegate
        self.session = URLSession(configuration: cfg, delegate: delegate, delegateQueue: nil)
        // PERF-I2 — Defer keychain reads off the main thread. AppState
        // calls `loadSessionFromKeychain()` from a detached task during
        // app startup; the published `hasSession` flag flips once the
        // probe completes. Tokens are nil until then; any in-flight
        // request before the probe finishes will surface as
        // `.notAuthenticated`, which is the correct behaviour because
        // we genuinely do not know whether a session exists.
        self.accessToken = nil
        self.refreshToken = nil
        self.cachedUserId = nil
        self.hasSession = false
    }

    // PERF-I2 — Off-main keychain probe. Called from AppState in a
    // detached task during launch; once it returns, the published
    // `hasSession` flag flips on the MainActor and AppState swaps
    // `.loading` for `.loggedIn` / `.loggedOut`.
    //
    // Returns the cachedUserId once the probe completes, so AppState
    // doesn't have to read `cachedUserId` racily during the same task.
    func loadSessionFromKeychain() async -> String? {
        let probed: (access: String?, refresh: String?, uid: String?) = await Task.detached(priority: .userInitiated) {
            let keychain = Keychain.shared
            return (
                keychain.read(.accessToken),
                keychain.read(.refreshToken),
                keychain.read(.userId)
            )
        }.value
        self.accessToken = probed.access
        self.refreshToken = probed.refresh
        self.cachedUserId = probed.uid
        self.hasSession = probed.access != nil
        return probed.uid
    }

    // PERF — single process-wide URLCache shared across every APIClient
    // instance so cacheable GETs survive view recreations. Sized
    // conservatively: 16MB in memory, 128MB on disk — enough for a few
    // hundred photos + a few hundred small JSON responses without
    // blowing the device's NSURLCache budget.
    private static let sharedURLCache: URLCache = {
        return URLCache(memoryCapacity: 16 * 1024 * 1024,
                        diskCapacity: 128 * 1024 * 1024,
                        directory: nil)
    }()

    func setSession(_ s: SessionResponse) {
        accessToken = s.accessToken
        refreshToken = s.refreshToken
        cachedUserId = s.userId
        Keychain.shared.write(.accessToken, s.accessToken)
        Keychain.shared.write(.refreshToken, s.refreshToken)
        Keychain.shared.write(.userId, s.userId)
        hasSession = true
    }

    func clearSession() {
        accessToken = nil
        refreshToken = nil
        cachedUserId = nil
        Keychain.shared.delete(.accessToken)
        Keychain.shared.delete(.refreshToken)
        Keychain.shared.delete(.userId)
        hasSession = false
    }

    // MARK: - Auth

    func startLogin(email: String, inviteCode: String? = nil) async throws -> StartLoginResponse {
        try await post("/api/v1/auth/start", body: StartLoginRequest(
            method: "email",
            email: email,
            appleIdentityToken: nil,
            devUserId: nil,
            inviteCode: inviteCode
        ))
    }

    func appleLogin(
        identityToken: String,
        rawNonce: String,
        inviteCode: String? = nil
    ) async throws -> SessionResponse {
        // SEV-M5 — `rawNonce` is the unhashed value that the coordinator
        // SHA-256-hashed into `request.nonce` before kicking off the
        // ASAuthorizationController flow. The backend re-hashes it and
        // compares against the `nonce` claim on the JWT.
        let s: SessionResponse = try await post("/api/v1/auth/start", body: StartLoginRequest(
            method: "apple",
            email: nil,
            appleIdentityToken: identityToken,
            devUserId: nil,
            inviteCode: inviteCode,
            appleRawNonce: rawNonce
        ))
        setSession(s)
        return s
    }

    func devLogin(userId: String, inviteCode: String? = nil) async throws -> SessionResponse {
        let s: SessionResponse = try await post("/api/v1/auth/start", body: StartLoginRequest(
            method: "dev",
            email: nil,
            appleIdentityToken: nil,
            devUserId: userId,
            inviteCode: inviteCode
        ))
        setSession(s)
        return s
    }

    func verifyLogin(challengeId: String, token: String) async throws -> SessionResponse {
        let s: SessionResponse = try await post(
            "/api/v1/auth/verify",
            body: VerifyLoginRequest(challengeId: challengeId, token: token)
        )
        setSession(s)
        return s
    }

    func logout() async throws {
        guard let token = refreshToken else { clearSession(); return }
        struct B: Codable { let refreshToken: String }
        let _: EmptyResponse = try await post("/api/v1/auth/logout", body: B(refreshToken: token))
        clearSession()
    }

    // MARK: - Discovery / swipes

    func loadDeck(limit: Int = 10) async throws -> DeckResponseDTO {
        try await get("/api/v1/discovery/deck?limit=\(limit)")
    }

    func swipe(_ req: SwipeRequest) async throws -> SwipeResponse {
        try await post("/api/v1/swipes", body: req)
    }

    func undoSwipe(swipeId: String) async throws {
        let _: EmptyResponse = try await post("/api/v1/swipes/\(swipeId)/undo", body: EmptyBody())
    }

    // MARK: - Likes / matches

    func incomingLikes() async throws -> LikesListResponse {
        try await get("/api/v1/likes/incoming")
    }

    func matches() async throws -> [MatchDTO] {
        try await get("/api/v1/matches/")
    }

    // MARK: - Chat

    func messages(conversationId: String) async throws -> [MessageDTO] {
        try await get("/api/v1/conversations/\(conversationId)/messages")
    }

    func sendMessage(conversationId: String, body: String) async throws -> MessageDTO {
        struct B: Codable { let body: String }
        return try await post("/api/v1/conversations/\(conversationId)/messages", body: B(body: body))
    }

    // DISC-Q2 — suggested conversation openers for an empty chat. The
    // endpoint is rate-limited server-side; callers should fetch once
    // when ConversationView appears and only re-fetch on a hard refresh.
    func suggestedOpeners(conversationId: String) async throws -> SuggestedOpenersResponse {
        try await get("/api/v1/conversations/\(conversationId)/suggested-openers")
    }

    // DISC-Q1 — record which deck cards iOS rendered so the next
    // /deck call can suppress the same faces. Best-effort: failures
    // surface up so the caller can swallow them; a missed impression
    // ping just degrades to the existing replay behaviour.
    func recordDeckImpressions(deckSessionId: String, targetUserIds: [String]) async throws {
        struct B: Codable { let deckSessionId: String; let targetUserIds: [String] }
        struct R: Codable { let recorded: Int }
        let _: R = try await post(
            "/api/v1/discovery/impressions",
            body: B(deckSessionId: deckSessionId, targetUserIds: targetUserIds)
        )
    }

    // Ably token request for the current user. The iOS client uses this to
    // open a realtime subscription scoped to its active conversations.
    func realtimeToken() async throws -> AblyTokenRequestDTO {
        try await post("/api/v1/realtime/token", body: EmptyBody())
    }

    // Read receipts. The recipient calls this when they open the
    // conversation; one request marks every previously-unread message
    // from the OTHER party as read and fans out a `read` Ably event so
    // the sender's UI can flip "Delivered" → "Read at HH:mm".
    @discardableResult
    func markConversationRead(conversationId: String) async throws -> Int {
        struct R: Codable { let updated: Int }
        let r: R = try await post("/api/v1/conversations/\(conversationId)/read", body: EmptyBody())
        return r.updated
    }

    // Reactions. Backend exposes POST/DELETE under /messages/:id/reactions.
    func addReaction(messageId: String, emoji: String) async throws {
        struct B: Codable { let emoji: String }
        let _: EmptyResponse = try await post(
            "/api/v1/messages/\(messageId)/reactions",
            body: B(emoji: emoji)
        )
    }

    func removeReaction(messageId: String, emoji: String) async throws {
        let escaped =
            emoji.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? emoji
        let _: EmptyResponse = try await delete(
            "/api/v1/messages/\(messageId)/reactions?emoji=\(escaped)"
        )
    }

    // Voice notes. Hand-rolled multipart so we can attach a `durationMs`
    // sibling field alongside the file part; uploadMultipart() above
    // only supports a single file part. Returns the canonical MessageDTO
    // with audioPath populated.
    func sendVoiceNote(
        conversationId: String,
        audio: Data,
        mimeType: String,
        durationMs: Int
    ) async throws -> MessageDTO {
        guard let url = URL(
            string: "/api/v1/conversations/\(conversationId)/messages/audio",
            relativeTo: baseURL
        ) else {
            throw APIError.transport(URLError(.badURL))
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        var body = Data()
        let CRLF = "\r\n"
        body.append("--\(boundary)\(CRLF)".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"durationMs\"\(CRLF)\(CRLF)".data(using: .utf8)!)
        body.append("\(durationMs)\(CRLF)".data(using: .utf8)!)
        body.append("--\(boundary)\(CRLF)".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"file\"; filename=\"note.m4a\"\(CRLF)"
                .data(using: .utf8)!
        )
        body.append("Content-Type: \(mimeType)\(CRLF)\(CRLF)".data(using: .utf8)!)
        body.append(audio)
        body.append("\(CRLF)--\(boundary)--\(CRLF)".data(using: .utf8)!)

        let (data, response) = try await session.upload(for: req, from: body)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.decode(data: data, status: http.statusCode)
        }
        return try decoder.decode(MessageDTO.self, from: data)
    }

    // Returns a short-lived signed URL for the audio attached to a
    // message. Mirrors the photo-url pattern: requester is re-authorized
    // server-side, and the returned URL points at /audio/serve.
    struct AudioURLDTO: Codable {
        let url: String
        let expiresAt: Date
    }

    func audioURL(messageId: String) async throws -> AudioURLDTO {
        try await get("/api/v1/conversations/messages/\(messageId)/audio/url")
    }

    // MARK: - Profile

    func getProfile() async throws -> ProfileDTO {
        try await get("/api/v1/profile/me/profile")
    }

    func updateProfile(_ patch: ProfileUpdateRequest) async throws -> ProfileDTO {
        try await self.patch("/api/v1/profile/me/profile", body: patch)
    }

    // MARK: - Profile photos

    // Server-mediated upload. We send the compressed JPEG bytes as
    // multipart/form-data; the backend stores them in Vercel Blob and
    // persists a ProfilePhoto row, which we return.
    func uploadPhoto(data: Data, mimeType: String = "image/jpeg") async throws -> PhotoDTO {
        try await uploadMultipart(
            "/api/v1/profile/me/photos",
            fileFieldName: "file",
            filename: "photo.jpg",
            mimeType: mimeType,
            data: data
        )
    }

    func deletePhoto(id: String) async throws {
        let _: EmptyResponse = try await delete("/api/v1/profile/me/photos/\(id)")
    }

    func reorderPhotos(_ photoIds: [String]) async throws -> [PhotoDTO] {
        struct B: Codable { let photoIds: [String] }
        return try await put("/api/v1/profile/me/photos/order", body: B(photoIds: photoIds))
    }

    // MARK: - Preferences

    func preferences() async throws -> PreferencesDTO {
        try await get("/api/v1/preferences/me")
    }

    func updatePreferences(_ prefs: PreferencesDTO) async throws -> PreferencesDTO {
        try await patch("/api/v1/preferences/me", body: prefs)
    }

    /// Patch only the handedness field. The backend route accepts a
    /// partial body so we avoid round-tripping the full preferences
    /// object every time a user changes their thumb-reach setting.
    func updateHandedness(_ handedness: Handedness) async throws -> PreferencesDTO {
        struct B: Codable { let handedness: String }
        return try await patch("/api/v1/preferences/me", body: B(handedness: handedness.rawValue))
    }

    // MARK: - Safety

    func report(reportedUserId: String, reason: String, details: String?) async throws {
        struct B: Codable {
            let reportedUserId: String
            let reason: String
            let details: String?
        }
        let _: EmptyResponse = try await post("/api/v1/safety/report", body: B(
            reportedUserId: reportedUserId, reason: reason, details: details
        ))
    }

    func block(userId: String) async throws {
        struct B: Codable { let blockedUserId: String }
        let _: EmptyResponse = try await post("/api/v1/safety/block", body: B(blockedUserId: userId))
    }

    func unblock(userId: String) async throws {
        let _: EmptyResponse = try await delete("/api/v1/safety/block/\(userId)")
    }

    func blockedUsers() async throws -> [BlockedUserDTO] {
        try await get("/api/v1/safety/blocked-users")
    }

    // MARK: - Transparency

    func algorithm() async throws -> AlgorithmTransparencyDTO {
        try await get("/api/v1/transparency/algorithm/current")
    }

    // MARK: - Privacy & rights

    // The /api/v1/privacy/* surface implements GDPR / CCPA rights:
    // access (export), correction, deletion, portability, restriction,
    // objection, and consent recording.

    func privacyExport() async throws -> Data {
        // Streams the full export bundle as JSON; the caller writes it
        // to a Files-app-shareable location.
        try await rawGet("/api/v1/privacy/export")
    }

    func recordConsent(scope: String, granted: Bool, surface: String = "ios") async throws {
        struct B: Codable { let scope: String; let granted: Bool; let surface: String }
        let _: EmptyResponse = try await post(
            "/api/v1/privacy/consents",
            body: B(scope: scope, granted: granted, surface: surface)
        )
    }

    func scheduleAccountDeletion(reason: String?) async throws -> AccountDeletionStatusDTO {
        struct B: Codable { let reason: String? }
        return try await post("/api/v1/privacy/account/deletion", body: B(reason: reason))
    }

    func cancelAccountDeletion() async throws {
        let _: EmptyResponse = try await delete("/api/v1/privacy/account/deletion")
    }

    func currentAccountDeletion() async throws -> AccountDeletionStatusDTO? {
        try await get("/api/v1/privacy/account/deletion")
    }

    func notificationPreferences() async throws -> NotificationPreferencesDTO {
        try await get("/api/v1/privacy/notifications")
    }

    func updateNotificationPreferences(_ prefs: NotificationPreferencesDTO) async throws
        -> NotificationPreferencesDTO
    {
        try await put("/api/v1/privacy/notifications", body: prefs)
    }

    // MARK: - Notifications · device token

    // Registers the iOS APNs device token with the backend so future
    // match/message pushes can be addressed to this install. The
    // backend stores one row per (userId, token) and dedupes.
    func registerDeviceToken(_ token: String) async throws {
        let req = RegisterDeviceRequest(
            platform: "ios",
            token: token,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            osVersion: UIDevice.current.systemVersion
        )
        let _: EmptyResponse = try await post("/api/v1/notifications/device-token", body: req)
    }

    // MARK: - Analytics

    // POSTs a batch of analytics events. The endpoint is best-effort;
    // failures are swallowed by the caller (Analytics actor).
    func recordAnalytics(events: [AnalyticsEvent]) async throws {
        let _: EmptyResponse = try await post(
            "/api/v1/analytics/event",
            body: AnalyticsBatch(events: events)
        )
    }

    // MARK: - Feedback

    func submitFeedback(
        category: String,
        body: String,
        email: String? = nil
    ) async throws {
        let req = FeedbackRequest(
            category: category,
            body: body,
            email: email,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            osVersion: UIDevice.current.systemVersion,
            deviceModel: UIDevice.current.model
        )
        let _: EmptyResponse = try await post("/api/v1/feedback", body: req)
    }

    // MARK: - Profile completeness

    // Tries the dedicated completeness endpoint first; if the backend
    // hasn't shipped it yet (404), falls back to computing client-side
    // from the canonical profile DTO. The "complete" rule must match
    // the discovery filter on the server: ≥ 2 photos, a display name,
    // and an age-verified DOB.
    func profileCompleteness() async throws -> ProfileCompletenessDTO {
        do {
            return try await get("/api/v1/profile/me/completeness")
        } catch APIError.notFound {
            return try await fallbackCompleteness()
        } catch APIError.http(let status, _) where status == 404 {
            return try await fallbackCompleteness()
        }
    }

    private func fallbackCompleteness() async throws -> ProfileCompletenessDTO {
        let p = try await getProfile()
        let displayName = p.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasPhotos = p.photos.count >= 2
        let hasName = !displayName.isEmpty
        // Server still owns 18+ validation. Until the dedicated
        // endpoint exists, treat "moderationStatus != pending"
        // *and* photos+name as a proxy for "ready to swipe".
        let isAgeVerified = p.moderationStatus != "pending_age_check"
        return ProfileCompletenessDTO(
            isComplete: hasPhotos && hasName && isAgeVerified,
            hasPhotos: hasPhotos,
            hasDisplayName: hasName,
            isAgeVerified: isAgeVerified,
            photoCount: p.photos.count
        )
    }

    // MARK: - HTTP plumbing

    private struct EmptyBody: Codable {}
    struct EmptyResponse: Codable {}

    private struct RefreshRequest: Codable { let refreshToken: String }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await omRunWithHTTPSpan(path) {
            let nilBody: EmptyBody? = nil
            return try await request(path: path, method: "GET", body: nilBody)
        }
    }

    // Raw GET that returns the response body as Data without decoding.
    // Used by the privacy-export endpoint which streams a large JSON
    // bundle directly to a file or share sheet.
    private func rawGet(_ path: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.transport(URLError(.badURL))
        }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }
        if http.statusCode == 401 { throw APIError.notAuthenticated }
        if !(200..<300).contains(http.statusCode) {
            throw APIError.decode(data: data, status: http.statusCode)
        }
        return data
    }

    private func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await omRunWithHTTPSpan(path) {
            try await request(path: path, method: "POST", body: body)
        }
    }

    private func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await omRunWithHTTPSpan(path) {
            try await request(path: path, method: "PATCH", body: body)
        }
    }

    private func put<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await omRunWithHTTPSpan(path) {
            try await request(path: path, method: "PUT", body: body)
        }
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        try await omRunWithHTTPSpan(path) {
            let nilBody: EmptyBody? = nil
            return try await request(path: path, method: "DELETE", body: nilBody)
        }
    }

    // Multipart/form-data upload. Hand-rolled because @fastify/multipart
    // wants a real multipart envelope and URLSession's `upload(for:from:)`
    // alone doesn't produce one.
    private func uploadMultipart<T: Decodable>(
        _ path: String,
        fileFieldName: String,
        filename: String,
        mimeType: String,
        data: Data,
        isRetry: Bool = false
    ) async throws -> T {
        try await omRunWithHTTPSpan(path) {
            try await uploadMultipartInner(
                path,
                fileFieldName: fileFieldName,
                filename: filename,
                mimeType: mimeType,
                data: data,
                isRetry: isRetry
            )
        }
    }

    private func uploadMultipartInner<T: Decodable>(
        _ path: String,
        fileFieldName: String,
        filename: String,
        mimeType: String,
        data: Data,
        isRetry: Bool
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.transport(URLError(.badURL))
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        var body = Data()
        let CRLF = "\r\n"
        body.append("--\(boundary)\(CRLF)".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fileFieldName)\"; filename=\"\(filename)\"\(CRLF)".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\(CRLF)\(CRLF)".data(using: .utf8)!)
        body.append(data)
        body.append("\(CRLF)--\(boundary)--\(CRLF)".data(using: .utf8)!)

        let respData: Data
        let http: HTTPURLResponse
        do {
            let (d, response) = try await session.upload(for: req, from: body)
            respData = d
            guard let h = response as? HTTPURLResponse else {
                throw APIError.transport(URLError(.badServerResponse))
            }
            http = h
        } catch let err as APIError {
            throw err
        } catch {
            // Round D — transport-level failures (DNS, TLS, refused
            // connection) feed Sentry so an outage shows up before
            // the user opens a bug report.
            Crash.capture(error)
            throw APIError.transport(error)
        }

        if http.statusCode == 401 && !isRetry && refreshToken != nil {
            let refreshed = await refreshIfNeeded()
            if refreshed {
                return try await uploadMultipart(
                    path,
                    fileFieldName: fileFieldName,
                    filename: filename,
                    mimeType: mimeType,
                    data: data,
                    isRetry: true
                )
            }
            clearSession()
            throw APIError.notAuthenticated
        }
        guard (200..<300).contains(http.statusCode) else {
            let err = APIError.decode(data: respData, status: http.statusCode)
            // Round D — 5xx is a real server fault worth a Sentry event;
            // 4xx is expected user-facing flow (rate limit, invalid invite).
            if http.statusCode >= 500 { Crash.capture(err) }
            throw err
        }
        do {
            return try decoder.decode(T.self, from: respData)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    private func request<B: Encodable, T: Decodable>(
        path: String,
        method: String,
        body: B?,
        isRetry: Bool = false
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.transport(URLError(.badURL))
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = body, method != "GET" {
            req.httpBody = try encoder.encode(body)
        }
        let data: Data
        let http: HTTPURLResponse
        do {
            let (d, response) = try await session.data(for: req)
            data = d
            guard let h = response as? HTTPURLResponse else {
                throw APIError.transport(URLError(.badServerResponse))
            }
            http = h
        } catch let err as APIError {
            throw err
        } catch {
            // Round D — see uploadMultipart for the rationale.
            Crash.capture(error)
            throw APIError.transport(error)
        }

        // Token rotation: a single in-flight refresh is shared by concurrent
        // 401s. If refresh succeeds, retry the original request once. If it
        // fails, surface notAuthenticated and clear session state.
        if http.statusCode == 401 && !isRetry && refreshToken != nil {
            let refreshed = await refreshIfNeeded()
            if refreshed {
                return try await request(path: path, method: method, body: body, isRetry: true)
            }
            clearSession()
            throw APIError.notAuthenticated
        }

        if http.statusCode == 204 || data.isEmpty {
            if let empty = EmptyResponse() as? T {
                return empty
            }
        }
        guard (200..<300).contains(http.statusCode) else {
            let err = APIError.decode(data: data, status: http.statusCode)
            if http.statusCode >= 500 { Crash.capture(err) }
            throw err
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    private func refreshIfNeeded() async -> Bool {
        if let task = refreshTask {
            return await task.value
        }
        let task = Task<Bool, Never> { [weak self] in
            guard let self else { return false }
            guard let rt = self.refreshToken else { return false }
            do {
                var req = URLRequest(url: URL(string: "/api/v1/auth/refresh", relativeTo: self.baseURL)!)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try self.encoder.encode(RefreshRequest(refreshToken: rt))
                let (data, response) = try await self.session.data(for: req)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    return false
                }
                let next = try self.decoder.decode(RefreshResponse.self, from: data)
                self.accessToken = next.accessToken
                self.refreshToken = next.refreshToken
                Keychain.shared.write(.accessToken, next.accessToken)
                Keychain.shared.write(.refreshToken, next.refreshToken)
                return true
            } catch {
                return false
            }
        }
        refreshTask = task
        let ok = await task.value
        refreshTask = nil
        return ok
    }
}

private struct RefreshResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
}
