import SwiftUI

@main
struct OpenMatchApp: App {
    // SwiftUI ↔ UIKit bridge for APNs token registration. The
    // AppDelegate is owned here so the SwiftUI runtime keeps it alive
    // for the lifetime of the app.
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // PERF — Sentry's `startWithOptions` synchronously spins up its
        // breadcrumb collectors, runtime monitors, and disk-backed
        // envelope queue. Doing that work inside `App.init()` blocks
        // the first frame from compositing. Move it to a detached
        // utility-priority Task so the app draws immediately and crash
        // reporting attaches a few hundred ms later. The window between
        // app launch and bootstrap completion is covered by Apple's
        // crash log handoff (next launch picks them up), so we don't
        // lose data on a crash inside that gap.
        Task.detached(priority: .utility) {
            Crash.bootstrap()
        }
        OMFont.debugDumpAvailableFamilies()
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView()
                    .environmentObject(appState)
                    .environmentObject(appState.api)
                    .environmentObject(appState.handedness)
                    .preferredColorScheme(nil)
                // SEV-M3 — privacy veil drawn above all content whenever
                // the scene is not active. Sits at the root of the
                // WindowGroup so it covers tab bars, sheets, and full
                // screen covers indiscriminately.
                if OMPrivacyVeil.isVisible(for: scenePhase) {
                    OMPrivacyVeil()
                        .transition(.identity)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                AppLifecycle.handleScenePhase(phase, appState: appState)
            }
        }
    }
}
