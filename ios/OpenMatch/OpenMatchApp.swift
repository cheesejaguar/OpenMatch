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
        // Crash reporting first — we want to capture any setup error
        // that follows. A missing DSN is a no-op (see Crash.swift).
        Crash.bootstrap()
        OMFont.debugDumpAvailableFamilies()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(appState.api)
                .preferredColorScheme(nil)
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        Task { await Analytics.shared.record("app.foreground") }
                    case .background:
                        Task {
                            await Analytics.shared.record("app.background")
                            // Force a flush — backgrounded apps may
                            // be suspended before the timer fires.
                            await Analytics.shared.flush()
                        }
                    default:
                        break
                    }
                }
        }
    }
}
