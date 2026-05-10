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

    init(api: APIClient = APIClient(baseURL: APIConfig.defaultBaseURL)) {
        self.api = api
        self.auth = api.hasSession ? .loggedIn(userId: api.cachedUserId ?? "self") : .loggedOut
    }

    func signOut() {
        api.clearSession()
        auth = .loggedOut
    }
}
