import SwiftUI


@MainActor
final class LookingForViewModel: ObservableObject {
    @Published var prefs: PreferencesDTO?
    @Published var presets: [MatchingPresetOptionDTO] = []
    @Published var defaultPresetKey: String = "balanced"
    @Published var error: String?
    @Published var isSaving = false
    @Published var saved = false
    var api: APIClient?

    func load() async {
        guard let api else { return }
        do { prefs = try await api.preferences() }
        catch { self.error = error.localizedDescription }
        // Best-effort: a presets failure shouldn't block editing the rest of
        // the preferences, so swallow its error and just hide the picker.
        if let catalog = try? await api.matchingPresets() {
            presets = catalog.presets
            defaultPresetKey = catalog.defaultKey
        }
    }
    func save() async {
        guard let api, let p = prefs else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            prefs = try await api.updatePreferences(p)
            saved = true
        }
        catch { self.error = error.localizedDescription }
    }
}

struct LookingForView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = LookingForViewModel()

    var body: some View {
        OMScreen {
            ScrollView {
                if let prefs = vm.prefs {
                    LazyVStack(spacing: OMSpacing.xl) {
                        OMSection("Age range") {
                            OMStepper(
                                label: "Minimum",
                                value: .init(
                                    get: { prefs.minAge },
                                    set: { var p = prefs; p.minAge = $0; vm.prefs = p }
                                ),
                                range: 18...100,
                                step: 1,
                                format: { "\($0)" }
                            )
                            OMSectionDivider()
                            OMStepper(
                                label: "Maximum",
                                value: .init(
                                    get: { prefs.maxAge },
                                    set: { var p = prefs; p.maxAge = $0; vm.prefs = p }
                                ),
                                range: 18...100,
                                step: 1,
                                format: { "\($0)" }
                            )
                        }

                        OMSection("Distance") {
                            OMPicker(
                                label: "Up to",
                                selection: .init(
                                    get: { prefs.maxDistanceKm },
                                    set: { var p = prefs; p.maxDistanceKm = $0; vm.prefs = p }
                                ),
                                options: [2, 10, 25, 50, 100, 250, 1000].map { (label: "\($0) km", value: $0) }
                            )
                        }

                        if !vm.presets.isEmpty {
                            OMSection("Discovery style") {
                                OMPicker(
                                    label: "Show me",
                                    selection: .init(
                                        get: { prefs.discoveryPresetKey ?? vm.defaultPresetKey },
                                        set: { var p = prefs; p.discoveryPresetKey = $0; vm.prefs = p }
                                    ),
                                    options: vm.presets.map { (label: $0.label, value: $0.key) }
                                )
                                if let chosen = vm.presets.first(where: {
                                    $0.key == (prefs.discoveryPresetKey ?? vm.defaultPresetKey)
                                }) {
                                    OMSectionDivider()
                                    Text(chosen.description)
                                        .font(OMFont.caption)
                                        .foregroundStyle(OMColor.inkMuted)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(OMSpacing.lg)
                                }
                            }
                        }

                        OMSection("Trust & focus") {
                            OMToggle(
                                label: "Verified profiles only",
                                caption: "Only show people who've passed photo verification.",
                                isOn: .init(
                                    get: { prefs.verifiedOnly },
                                    set: { var p = prefs; p.verifiedOnly = $0; vm.prefs = p }
                                )
                            )
                            OMSectionDivider()
                            OMToggle(
                                label: "Focus mode",
                                caption: "Quiet the deck so you can focus on the conversations you've already started.",
                                isOn: .init(
                                    get: { prefs.focusMode },
                                    set: { var p = prefs; p.focusMode = $0; vm.prefs = p }
                                )
                            )
                        }

                        OMSection("Goals") {
                            OMToggle(
                                label: "Exclude incompatible goals",
                                isOn: .init(
                                    get: { prefs.excludeIncompatibleGoals },
                                    set: { var p = prefs; p.excludeIncompatibleGoals = $0; vm.prefs = p }
                                )
                            )
                            OMSectionDivider()
                            OMToggle(
                                label: "Include unanswered optional fields",
                                caption: "People who skipped optional questions can still appear.",
                                isOn: .init(
                                    get: { prefs.includeUnansweredOptionalFields },
                                    set: { var p = prefs; p.includeUnansweredOptionalFields = $0; vm.prefs = p }
                                )
                            )
                        }

                        OMSection("Incoming likes") {
                            VStack(spacing: 0) {
                                OMSegmented(
                                    selection: .init(
                                        get: { prefs.likesVisibility },
                                        set: { var p = prefs; p.likesVisibility = $0; vm.prefs = p }
                                    ),
                                    options: [
                                        (label: "Visible", value: "visible"),
                                        (label: "Count", value: "count_only"),
                                        (label: "Hidden", value: "hidden"),
                                    ]
                                )
                                .padding(OMSpacing.lg)
                            }
                        }

                        Button {
                            Task { await vm.save() }
                        } label: {
                            if vm.isSaving { ProgressView().tint(OMColor.onAccent) } else { Text("Save preferences") }
                        }
                        .buttonStyle(OMPrimaryButtonStyle())
                        .disabled(vm.isSaving)

                        Text("These filters are free. OpenMatch will never gate filters behind a subscription.")
                            .font(OMFont.caption)
                            .foregroundStyle(OMColor.inkMuted)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    .padding(OMSpacing.lg)
                } else {
                    ProgressView()
                        .tint(OMColor.plum)
                        .padding(.top, 80)
                }
            }
        }
        .omNavTitle("Looking for")
        .task {
            vm.api = api
            if vm.prefs == nil { await vm.load() }
        }
        .alert("Saved", isPresented: $vm.saved) {
            Button("OK", role: .cancel) {}
        }
        .alert("Couldn't update", isPresented: .init(
            get: { vm.error != nil },
            set: { _ in vm.error = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.error ?? "")
        }
    }
}
