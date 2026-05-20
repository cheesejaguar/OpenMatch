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
    let handedness: HandednessStore

    // The default APIClient must be constructed inside the body — its
    // init is @MainActor-isolated and Swift evaluates default parameter
    // expressions in a nonisolated context at the call site, even though
    // AppState itself is @MainActor.
    init(api: APIClient? = nil) {
        let client = api ?? APIClient(baseURL: APIConfig.defaultBaseURL)
        self.api = client
        self.handedness = HandednessStore(api: client)
        self.auth = client.hasSession ? .loggedIn(userId: client.cachedUserId ?? "self") : .loggedOut
        if client.hasSession {
            RealtimeService.shared.connect(api: client)
            Crash.setUser(id: client.cachedUserId)
            // Server is source of truth — pull on launch so a
            // setting changed on another device propagates here.
            let store = handedness
            Task { await store.refreshFromServer() }
        }
        // Analytics is fire-and-forget; attach now so any pre-login
        // events (e.g. signup funnel) reach the backend.
        Task { await Analytics.shared.attach(api: client) }

        // Forward APNs device tokens to the backend whenever they
        // arrive. We only have one AppState per process, but we
        // capture weakly to be safe.
        AppDelegate.shared.onDeviceToken = { [weak self] token in
            guard let self else { return }
            guard self.api.hasSession else { return }
            Task { try? await self.api.registerDeviceToken(token) }
        }
        #if DEBUG
        // UX-review hook: launching with -OPENMATCH_AUTO_LOGIN <userId>
        // dev-logs that user in immediately so screenshot scripts can
        // skip the Welcome flow. Read the launch arg via simctl:
        //   SIMCTL_CHILD_OPENMATCH_AUTO_LOGIN=u001 xcrun simctl launch …
        if let uid = ProcessInfo.processInfo.environment["OPENMATCH_AUTO_LOGIN"], !uid.isEmpty {
            Task { @MainActor in
                client.clearSession()
                do {
                    _ = try await client.devLogin(userId: uid)
                    self.didSignIn(userId: uid)
                } catch {
                    print("[UX] auto-login failed: \(error)")
                }
            }
        }
        #endif
    }

    func didSignIn(userId: String) {
        auth = .loggedIn(userId: userId)
        RealtimeService.shared.connect(api: api)
        Crash.setUser(id: userId)
        let store = handedness
        Task { await store.refreshFromServer() }
    }

    func signOut() {
        RealtimeService.shared.disconnect()
        api.clearSession()
        Crash.setUser(id: nil)
        auth = .loggedOut
    }
}
