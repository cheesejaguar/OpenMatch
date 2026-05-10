import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        switch appState.auth {
        case .loading:
            ProgressView().controlSize(.large)
        case .loggedOut:
            WelcomeView()
        case .onboarding(let userId):
            OnboardingFlowView(userId: userId)
        case .loggedIn:
            MainTabView()
        }
    }
}
