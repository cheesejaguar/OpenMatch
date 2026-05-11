import Foundation

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

    func startLogin(email: String) async throws -> StartLoginResponse {
        try await post("/api/v1/auth/start", body: StartLoginRequest(
            method: "email",
            email: email,
            appleIdentityToken: nil,
            devUserId: nil
        ))
    }

    func devLogin(userId: String) async throws -> SessionResponse {
        let s: SessionResponse = try await post("/api/v1/auth/start", body: StartLoginRequest(
            method: "dev",
            email: nil,
            appleIdentityToken: nil,
            devUserId: userId
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

    // MARK: - HTTP plumbing

    private struct EmptyBody: Codable {}
    struct EmptyResponse: Codable {}

    private struct RefreshRequest: Codable { let refreshToken: String }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let nilBody: EmptyBody? = nil
        return try await request(path: path, method: "GET", body: nilBody)
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
