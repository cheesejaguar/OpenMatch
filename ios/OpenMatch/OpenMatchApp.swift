import SwiftUI

@main
struct OpenMatchApp: App {
    // SwiftUI ↔ UIKit bridge for APNs token registration. The
    // AppDelegate is owned here so the SwiftUI runtime keeps it alive
    // for the lifetime of the app.
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    /// PERF-TELEMETRY: cold-launch transaction, finished when RootView
    /// first appears. Lets us track p50/p95 first-frame time across app
    /// versions in Sentry's performance UI. The wall-clock measurement
    /// starts from process-init (we begin the transaction here before
    /// any deferred work) and ends in RootView.onAppear.
    let launchTransactionFinish: () -> Void

    init() {
        // PERF-TELEMETRY — begin the cold-launch transaction. Until
        // Crash.bootstrap() completes on the detached task below
        // SentrySDK isn't actually started, so this returns a no-op
        // finisher. The "real" launch-timing trace will start once a
        // bootstrap has happened (warm starts only — typically the
        // second cold launch the user makes per session). That's the
        // right cohort to measure: the first-ever launch's timing is
        // dominated by Sentry init itself.
        launchTransactionFinish = Crash.startTransaction(
            name: "app.cold_launch",
            operation: "app.start",
        )
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
            .onAppear {
                // PERF-TELEMETRY — finish the cold-launch transaction
                // once the root window has rendered. SwiftUI fires this
                // on first appear of the WindowGroup contents.
                launchTransactionFinish()
            }
        }
    }
}
