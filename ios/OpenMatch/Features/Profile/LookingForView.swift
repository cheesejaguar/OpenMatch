import SwiftUI

@MainActor
final class LookingForViewModel: ObservableObject {
    @Published var prefs: PreferencesDTO?
    @Published var error: String?
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async {
        do { prefs = try await api.preferences() }
        catch { self.error = error.localizedDescription }
    }
    func save() async {
        guard let p = prefs else { return }
        do { prefs = try await api.updatePreferences(p) }
        catch { self.error = error.localizedDescription }
    }
}

struct LookingForView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = LookingForViewModel(api: APIClient(baseURL: APIConfig.defaultBaseURL))

    var body: some View {
        Form {
            if let prefs = vm.prefs {
                Section("Age range") {
                    Stepper("Minimum: \(prefs.minAge)", value: .init(
                        get: { prefs.minAge },
                        set: { var p = prefs; p.minAge = $0; vm.prefs = p }
                    ), in: 18...100)
                    Stepper("Maximum: \(prefs.maxAge)", value: .init(
                        get: { prefs.maxAge },
                        set: { var p = prefs; p.maxAge = $0; vm.prefs = p }
                    ), in: 18...100)
                }
                Section("Distance") {
                    Picker("Up to", selection: .init(
                        get: { prefs.maxDistanceKm },
                        set: { var p = prefs; p.maxDistanceKm = $0; vm.prefs = p }
                    )) {
                        ForEach([2, 10, 25, 50, 100, 250, 1000], id: \.self) { km in
                            Text("\(km) km").tag(km)
                        }
                    }
                }
                Section("Goals") {
                    Toggle("Exclude incompatible goals", isOn: .init(
                        get: { prefs.excludeIncompatibleGoals },
                        set: { var p = prefs; p.excludeIncompatibleGoals = $0; vm.prefs = p }
                    ))
                    Toggle("Include profiles that didn't answer optional fields", isOn: .init(
                        get: { prefs.includeUnansweredOptionalFields },
                        set: { var p = prefs; p.includeUnansweredOptionalFields = $0; vm.prefs = p }
                    ))
                }
                Section("Likes visibility") {
                    Picker("Incoming likes", selection: .init(
                        get: { prefs.likesVisibility },
                        set: { var p = prefs; p.likesVisibility = $0; vm.prefs = p }
                    )) {
                        Text("Visible").tag("visible")
                        Text("Count only").tag("count_only")
                        Text("Hidden").tag("hidden")
                    }
                }
                Section {
                    Button("Save preferences") { Task { await vm.save() } }
                        .buttonStyle(OMPrimaryButtonStyle())
                }
                Section {
                    Text("These filters are free. OpenMatch will never gate filters behind a subscription.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Looking for")
        .task { await vm.load() }
    }
}
