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

    // MARK: - Session management

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

    // MARK: - Public auth endpoints

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

    // MARK: - Core domain

    func loadDeck(limit: Int = 10) async throws -> DeckResponseDTO {
        try await get("/api/v1/discovery/deck?limit=\(limit)")
    }

    func swipe(_ req: SwipeRequest) async throws -> SwipeResponse {
        try await post("/api/v1/swipes", body: req)
    }

    func undoSwipe(swipeId: String) async throws {
        let _: EmptyResponse = try await post("/api/v1/swipes/\(swipeId)/undo", body: EmptyBody())
    }

    func incomingLikes() async throws -> LikesListResponse {
        try await get("/api/v1/likes/incoming")
    }

    func matches() async throws -> [MatchDTO] {
        try await get("/api/v1/matches/")
    }

    func messages(conversationId: String) async throws -> [MessageDTO] {
        try await get("/api/v1/conversations/\(conversationId)/messages")
    }

    func sendMessage(conversationId: String, body: String) async throws -> MessageDTO {
        struct B: Codable { let body: String }
        return try await post("/api/v1/conversations/\(conversationId)/messages", body: B(body: body))
    }

    func preferences() async throws -> PreferencesDTO {
        try await get("/api/v1/preferences/me")
    }

    func updatePreferences(_ prefs: PreferencesDTO) async throws -> PreferencesDTO {
        try await patch("/api/v1/preferences/me", body: prefs)
    }

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

    func algorithm() async throws -> AlgorithmTransparencyDTO {
        try await get("/api/v1/transparency/algorithm/current")
    }

    // MARK: - Internals

    private struct EmptyBody: Codable {}
    private struct EmptyResponse: Codable {}

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "GET", body: nil)
    }

    private func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "POST", body: body)
    }

    private func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        try await request(path: path, method: "PATCH", body: body)
    }

    private func request<B: Encodable, T: Decodable>(
        path: String,
        method: String,
        body: B?
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
        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.transport(URLError(.badServerResponse))
            }
            if http.statusCode == 204 || data.isEmpty {
                if T.self == EmptyResponse.self {
                    return EmptyResponse() as! T
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
        } catch let err as APIError {
            throw err
        } catch {
            throw APIError.transport(error)
        }
    }
}
