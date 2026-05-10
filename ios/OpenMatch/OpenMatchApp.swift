import SwiftUI

@main
struct OpenMatchApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(appState.api)
                .preferredColorScheme(nil)
        }
    }
}
