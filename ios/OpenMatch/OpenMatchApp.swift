import SwiftUI

@main
struct OpenMatchApp: App {
    @StateObject private var appState = AppState()

    init() {
        OMFont.debugDumpAvailableFamilies()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(appState.api)
                .preferredColorScheme(nil)
        }
    }
}
