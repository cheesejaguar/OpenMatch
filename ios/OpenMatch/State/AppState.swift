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
        // PERF-I2 — Start in `.loading` and probe the keychain off the
        // main thread. The first frame renders against the existing
        // `.loading` branch of `RootView` (which shows a ProgressView)
        // and flips to `.loggedIn` / `.loggedOut` once the detached
        // probe completes (~10-50ms typical, longer right after device
        // unlock when the Secure Enclave is warming up).
        self.auth = .loading

        // Forward APNs device tokens to the backend whenever they
        // arrive. We only have one AppState per process, but we
        // capture weakly to be safe.
        AppDelegate.shared.onDeviceToken = { [weak self] token in
            guard let self else { return }
            guard self.api.hasSession else { return }
            Task { try? await self.api.registerDeviceToken(token) }
        }

        // Kick off the off-main keychain probe + analytics attach.
        // Order: probe → flip auth → run side-effects gated on a real
        // session. Analytics + handedness refresh do not need the
        // session to be probed first.
        Task { await Analytics.shared.attach(api: client) }
        let store = handedness
        Task { @MainActor [weak self] in
            let uid = await client.loadSessionFromKeychain()
            guard let self else { return }
            // If a test (or a sign-in flow that raced the probe) has
            // already mutated `auth` away from `.loading`, don't
            // clobber it. The keychain reflects what we just read; the
            // newer assignment is what the caller intended.
            guard self.auth == .loading else { return }
            if client.hasSession {
                self.auth = .loggedIn(userId: uid ?? "self")
                RealtimeService.shared.connect(api: client)
                Crash.setUser(id: uid)
                // Server is source of truth — pull on launch so a
                // setting changed on another device propagates here.
                await store.refreshFromServer()
            } else {
                self.auth = .loggedOut
            }
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
