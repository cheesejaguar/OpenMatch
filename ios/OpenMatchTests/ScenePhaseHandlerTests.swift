import XCTest
import SwiftUI
@testable import OpenMatch

@MainActor
final class ScenePhaseHandlerTests: XCTestCase {
    private func makeAppState() -> AppState {
        // Build an APIClient that doesn't carry over keychain state from
        // a prior simulator run — otherwise hasSession can be true and
        // AppState's init triggers a real Ably connect attempt.
        let api = APIClient(baseURL: URL(string: "https://test.openmatch.local")!)
        api.clearSession()
        return AppState(api: api)
    }

    func testBackgroundDisconnectsRealtimeAndRecordsAnalytics() {
        let realtime = StubRealtime()
        let analytics = StubAnalyticsSink()
        let appState = makeAppState()
        // Force the auth state into loggedIn so the active-phase test
        // below has a reason to reconnect.
        appState.simulateLoggedIn(userId: "u1")

        AppLifecycle.handleScenePhase(
            .background,
            appState: appState,
            realtime: realtime,
            analytics: analytics
        )

        XCTAssertEqual(realtime.disconnectCount, 1)
        XCTAssertEqual(realtime.connectCount, 0)
        XCTAssertTrue(analytics.events.contains("app.background"))
    }

    func testActiveReconnectsWhenLoggedIn() {
        let realtime = StubRealtime()
        let analytics = StubAnalyticsSink()
        let appState = makeAppState()
        appState.simulateLoggedIn(userId: "u1")

        AppLifecycle.handleScenePhase(
            .active,
            appState: appState,
            realtime: realtime,
            analytics: analytics
        )

        XCTAssertEqual(realtime.connectCount, 1)
        XCTAssertEqual(realtime.disconnectCount, 0)
        XCTAssertTrue(analytics.events.contains("app.foreground"))
    }

    func testActiveSkipsReconnectWhenLoggedOut() {
        let realtime = StubRealtime()
        let analytics = StubAnalyticsSink()
        let appState = makeAppState()
        // Default state is .loggedOut (no keychain entries in tests).
        XCTAssertFalse(appState.isLoggedIn)

        AppLifecycle.handleScenePhase(
            .active,
            appState: appState,
            realtime: realtime,
            analytics: analytics
        )

        XCTAssertEqual(realtime.connectCount, 0)
        XCTAssertTrue(analytics.events.contains("app.foreground"))
    }

    func testActivePostsForegroundNotification() {
        let realtime = StubRealtime()
        let analytics = StubAnalyticsSink()
        let appState = makeAppState()
        let exp = expectation(forNotification: .openMatchDidForeground, object: nil)

        AppLifecycle.handleScenePhase(
            .active,
            appState: appState,
            realtime: realtime,
            analytics: analytics
        )

        wait(for: [exp], timeout: 1)
    }

    func testInactiveIsNoOp() {
        let realtime = StubRealtime()
        let analytics = StubAnalyticsSink()
        let appState = makeAppState()

        AppLifecycle.handleScenePhase(
            .inactive,
            appState: appState,
            realtime: realtime,
            analytics: analytics
        )

        XCTAssertEqual(realtime.connectCount, 0)
        XCTAssertEqual(realtime.disconnectCount, 0)
        XCTAssertTrue(analytics.events.isEmpty)
    }
}

// MARK: - Stubs

@MainActor
final class StubRealtime: RealtimeBackgroundable {
    var connectCount = 0
    var disconnectCount = 0
    func connect(api: APIClient) { connectCount += 1 }
    func disconnect() { disconnectCount += 1 }
}

@MainActor
final class StubAnalyticsSink: ScenePhaseAnalyticsSink {
    var events: [String] = []
    func record(_ name: String) { events.append(name) }
}

// Test hook to flip auth state without going through the network. The
// production code path (didSignIn) also touches RealtimeService, which
// would attempt a real Ably connect — that's why we route through this
// test-only setter.
extension AppState {
    func simulateLoggedIn(userId: String) {
        // We can't set `auth` directly because @Published is internal,
        // but the @Published wrapper exposes a setter through the
        // synthesized property. AppState lives in the same module under
        // @testable import OpenMatch so this is reachable.
        self.auth = .loggedIn(userId: userId)
    }
}
