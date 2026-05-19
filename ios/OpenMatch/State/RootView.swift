import SwiftUI

// IOS-6 — profile-completeness gate. Polled when the user lands on
// the main tabs. If the profile is incomplete, we replace the Swipe
// tab content with a CTA to finish the profile and show a sticky
// banner on the other tabs. The server already filters incomplete
// profiles out of its discovery query; this gate just makes the
// failure mode readable.
@MainActor
final class ProfileGate: ObservableObject {
    @Published var isComplete: Bool = true
    @Published var dto: ProfileCompletenessDTO?

    private weak var api: APIClient?
    private var isRefreshing = false

    func attach(api: APIClient) {
        self.api = api
    }

    func refresh() async {
        guard let api, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let res = try await api.profileCompleteness()
            self.dto = res
            self.isComplete = res.isComplete
        } catch {
            // On error, fail open so we don't lock users out due to a
            // network blip. The server's discovery query is the
            // authoritative gate either way.
            self.isComplete = true
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var gate = ProfileGate()

    var body: some View {
        switch appState.auth {
        case .loading:
            ProgressView().controlSize(.large)
        case .loggedOut:
            WelcomeView()
        case .onboarding(let userId):
            OnboardingFlowView(userId: userId)
        case .loggedIn:
            MainTabView(gate: gate)
                .task {
                    gate.attach(api: appState.api)
                    await gate.refresh()
                }
        }
    }
}
