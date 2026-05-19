import Foundation
import UIKit

enum APIError: Error, LocalizedError {
    case notAuthenticated
    case http(Int, String?)
    case decoding(String)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "You're not signed in."
        case .http(let code, let msg): return "HTTP \(code)\(msg.map { ": \($0)" } ?? "")"
        case .decoding(let msg): return "Decoding error: \(msg)"
        case .transport(let err): return err.localizedDescription
        }
    }
}


@MainActor
final class APIClient: ObservableObject {
    let baseURL: URL
    @Published private(set) var hasSession: Bool
    private(set) var cachedUserId: String?

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private var accessToken: String?
    private var refreshToken: String?

    // Concurrent 401s in a busy UI must not fire N parallel /refresh calls.
    // Coalesce into a single in-flight refresh task per APIClient.
    private var refreshTask: Task<Bool, Never>?

    init(baseURL: URL) {
        self.baseURL = baseURL
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = true
        #if DEBUG
        // Local dev runs the simulator against the country gate without
        // any edge headers. Announce a supported country so /auth/start
        // doesn't 451. Production requests are tagged by Vercel/Cloudflare.
        cfg.httpAdditionalHeaders = ["x-openmatch-country": "US"]
        #endif
        self.session = URLSession(configuration: cfg)
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
        let keychain = Keychain.shared
        self.accessToken = keychain.read(.accessToken)
        self.refreshToken = keychain.read(.refreshToken)
        self.cachedUserId = keychain.read(.userId)
        self.hasSession = self.accessToken != nil
    }

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

    func appleLogin(identityToken: String, inviteCode: String? = nil) async throws -> SessionResponse {
        let s: SessionResponse = try await post("/api/v1/auth/start", body: StartLoginRequest(
            method: "apple",
            email: nil,
            appleIdentityToken: identityToken,
            devUserId: nil,
            inviteCode: inviteCode
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

    // Ably token request for the current user. The iOS client uses this to
    // open a realtime subscription scoped to its active conversations.
    func realtimeToken() async throws -> AblyTokenRequestDTO {
        try await post("/api/v1/realtime/token", body: EmptyBody())
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
        } catch APIError.http(let code, _) where code == 404 {
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
    }

    // MARK: - HTTP plumbing

    private struct EmptyBody: Codable {}
    struct EmptyResponse: Codable {}

    private struct RefreshRequest: Codable { let refreshToken: String }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let nilBody: EmptyBody? = nil
        return try await request(path: path, method: "GET", body: nilBody)
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
            throw APIError.http(http.statusCode, String(data: data, encoding: .utf8))
        }
        return data
    }

    private func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "POST", body: body)
    }

    private func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "PATCH", body: body)
    }

    private func put<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "PUT", body: body)
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        let nilBody: EmptyBody? = nil
        return try await request(path: path, method: "DELETE", body: nilBody)
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
            let msg = String(data: respData, encoding: .utf8)
            throw APIError.http(http.statusCode, msg)
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
            let msg = String(data: data, encoding: .utf8)
            throw APIError.http(http.statusCode, msg)
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
