import Foundation
import SwiftUI


@MainActor
final class AppState: ObservableObject {
    enum AuthState: Equatable {
        case loading
        case loggedOut
        case onboarding(userId: String)
        case loggedIn(userId: String)
    }

    @Published var auth: AuthState = .loading
    @Published var likesVisibility: LikesVisibility = .visible

    let api: APIClient

    // The default APIClient must be constructed inside the body — its
    // init is @MainActor-isolated and Swift evaluates default parameter
    // expressions in a nonisolated context at the call site, even though
    // AppState itself is @MainActor.
    init(api: APIClient? = nil) {
        let client = api ?? APIClient(baseURL: APIConfig.defaultBaseURL)
        self.api = client
        self.auth = client.hasSession ? .loggedIn(userId: client.cachedUserId ?? "self") : .loggedOut
        if client.hasSession {
            RealtimeService.shared.connect(api: client)
        }
    }

    func didSignIn(userId: String) {
        auth = .loggedIn(userId: userId)
        RealtimeService.shared.connect(api: api)
    }

    func signOut() {
        RealtimeService.shared.disconnect()
        api.clearSession()
        auth = .loggedOut
    }
}
