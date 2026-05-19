import SwiftUI

// Centralized scenePhase handling. The app drops its Ably connection when
// backgrounded — iOS will tear down our sockets after ~30s of suspension
// anyway, and explicitly closing avoids leaking channels through a kill
// cycle. We re-open on .active when the user is still signed in.
//
// Tested directly in OpenMatchTests/ScenePhaseHandlerTests.swift —
// SwiftUI's scenePhase is not driveable from a XCUI test in a reasonable
// way, so the logic lives here and is exercised as a pure function.
@MainActor
enum AppLifecycle {
    static func handleScenePhase(
        _ phase: ScenePhase,
        appState: AppState,
        realtime: RealtimeBackgroundable? = nil,
        analytics: ScenePhaseAnalyticsSink? = nil
    ) {
        // Default the collaborators here (inside an isolated context) so
        // the call-site doesn't need to evaluate @MainActor initializers
        // in a nonisolated default-argument expression.
        let realtime = realtime ?? RealtimeService.shared
        let analytics = analytics ?? LiveAnalyticsSink()
        switch phase {
        case .background:
            // Drop the Ably connection so we don't sit on a zombie socket
            // while the OS is about to suspend us. Channels are recreated
            // lazily on reconnect.
            realtime.disconnect()
            analytics.record("app.background")
            Task { await Analytics.shared.flush() }
        case .active:
            if appState.isLoggedIn {
                realtime.connect(api: appState.api)
            }
            analytics.record("app.foreground")
            // Tell any visible views to refresh state — they may have
            // missed Ably publishes while suspended.
            NotificationCenter.default.post(name: .openMatchDidForeground, object: nil)
        case .inactive:
            break
        @unknown default:
            break
        }
    }
}

extension Notification.Name {
    // Posted on the main thread when the app transitions from
    // background → active. Subscribers (e.g. ConversationView) use this
    // to pull missed REST state since Ably may have dropped events.
    static let openMatchDidForeground = Notification.Name("OpenMatch.didForeground")
}

// MARK: - Test seams

// RealtimeService conforms to this protocol so the scenePhase handler
// can be unit-tested without standing up Ably.
@MainActor
protocol RealtimeBackgroundable: AnyObject {
    func connect(api: APIClient)
    func disconnect()
}

extension RealtimeService: RealtimeBackgroundable {}

@MainActor
protocol ScenePhaseAnalyticsSink {
    func record(_ name: String)
}

@MainActor
struct LiveAnalyticsSink: ScenePhaseAnalyticsSink {
    func record(_ name: String) {
        Task { await Analytics.shared.record(name) }
    }
}

extension AppState {
    // Convenience for the lifecycle handler — we only want to reconnect
    // Ably when the user actually has a session to subscribe with.
    var isLoggedIn: Bool {
        if case .loggedIn = auth { return true }
        return false
    }
}
