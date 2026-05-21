import XCTest
@testable import OpenMatch

// PERF-I2 — AppState now starts in `.loading` and probes the keychain
// off the main thread. These tests assert the launch state machine
// holds the right invariants.
@MainActor
final class AppStateLaunchTests: XCTestCase {
    func testInitialAuthIsLoading() {
        let api = APIClient(baseURL: URL(string: "https://test.openmatch.local")!)
        api.clearSession()
        let state = AppState(api: api)
        // The probe runs on a detached task; the synchronous return of
        // `init` must leave the published state at `.loading` so
        // `RootView` shows the progress indicator immediately on cold
        // start instead of paying for the keychain read inline.
        XCTAssertEqual(state.auth, .loading)
        XCTAssertFalse(state.isLoggedIn)
    }

    func testProbeResolvesToLoggedOutWhenNoSession() async {
        let api = APIClient(baseURL: URL(string: "https://test.openmatch.local")!)
        api.clearSession()
        let state = AppState(api: api)
        // Yield until the detached keychain task has had a chance to
        // run and post back to the MainActor.
        for _ in 0..<50 {
            if state.auth != .loading { break }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertEqual(state.auth, .loggedOut)
    }

    func testSimulatedSignInWinsOverPendingProbe() async {
        let api = APIClient(baseURL: URL(string: "https://test.openmatch.local")!)
        api.clearSession()
        let state = AppState(api: api)
        // Race the probe by setting `.loggedIn` immediately. The probe
        // (when it lands) must not clobber a newer caller-supplied
        // state.
        state.simulateLoggedIn(userId: "u1")
        for _ in 0..<50 {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertEqual(state.auth, .loggedIn(userId: "u1"))
    }
}
