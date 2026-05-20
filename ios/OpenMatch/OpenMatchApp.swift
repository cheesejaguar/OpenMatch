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
                .environmentObject(appState.handedness)
                .preferredColorScheme(nil)
                .onChange(of: scenePhase) { _, phase in
                    AppLifecycle.handleScenePhase(phase, appState: appState)
                }
        }
    }
}
