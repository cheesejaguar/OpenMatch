import SwiftUI

// Post-match outcome + two-sided feedback (#1/#11). Private to the author —
// the other person never sees it. "Did you meet?" gates the follow-ups; the
// respectful / matched-profile answers feed the safety pipeline, and the
// want-to-continue answer feeds matching outcomes.
@MainActor
final class DateFeedbackViewModel: ObservableObject {
    @Published var met: Bool?
    @Published var wantToContinue: Bool?
    @Published var respectful: Bool?
    @Published var matchedProfile: Bool?
    @Published var isSaving = false
    @Published var error: String?

    var api: APIClient?
    let matchId: String

    init(matchId: String) { self.matchId = matchId }

    var canSubmit: Bool { met != nil }

    func submit() async -> Bool {
        guard let api, let met else { return false }
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.submitDateFeedback(
                matchId: matchId,
                DateFeedbackRequest(
                    met: met,
                    wantToContinue: met ? wantToContinue : nil,
                    respectful: met ? respectful : nil,
                    matchedProfile: met ? matchedProfile : nil,
                    note: nil
                )
            )
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

struct DateFeedbackView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm: DateFeedbackViewModel
    let peerName: String
    var onComplete: () -> Void = {}

    init(matchId: String, peerName: String, onComplete: @escaping () -> Void = {}) {
        _vm = StateObject(wrappedValue: DateFeedbackViewModel(matchId: matchId))
        self.peerName = peerName
        self.onComplete = onComplete
    }

    var body: some View {
        OMScreen {
            ScrollView {
                VStack(alignment: .leading, spacing: OMSpacing.xl) {
                    Text("How did it go with \(peerName)?")
                        .font(OMFont.display(22, weight: .semibold, italic: true))
                        .foregroundStyle(OMColor.ink)
                    Text("Your answers are private — \(peerName) will never see them. They help us keep OpenMatch safe and show you more people like the ones you click with.")
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)

                    yesNo("Did you two meet up?", selection: $vm.met, includeNotYet: true)

                    if vm.met == true {
                        yesNo("Would you like to see them again?", selection: $vm.wantToContinue)
                        yesNo("Were they respectful?", selection: $vm.respectful)
                        yesNo("Did they match their profile?", selection: $vm.matchedProfile)
                    }

                    Button {
                        Task {
                            if await vm.submit() {
                                onComplete()
                                dismiss()
                            }
                        }
                    } label: {
                        if vm.isSaving {
                            ProgressView().tint(OMColor.onAccent)
                        } else {
                            Text("Submit")
                        }
                    }
                    .buttonStyle(OMPrimaryButtonStyle())
                    .disabled(!vm.canSubmit || vm.isSaving)

                    Button("Skip for now") { dismiss() }
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)
                        .frame(maxWidth: .infinity)
                }
                .padding(OMSpacing.lg)
            }
        }
        .task { vm.api = api }
        .alert("Couldn't submit", isPresented: .init(
            get: { vm.error != nil },
            set: { _ in vm.error = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.error ?? "")
        }
    }

    @ViewBuilder
    private func yesNo(_ q: String, selection: Binding<Bool?>, includeNotYet: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: OMSpacing.sm) {
            Text(q)
                .font(OMFont.body(16, weight: .semibold))
                .foregroundStyle(OMColor.ink)
            HStack(spacing: OMSpacing.sm) {
                choice("Yes", isOn: selection.wrappedValue == true) { selection.wrappedValue = true }
                if includeNotYet {
                    choice("Not yet", isOn: selection.wrappedValue == false) {
                        selection.wrappedValue = false
                    }
                } else {
                    choice("No", isOn: selection.wrappedValue == false) {
                        selection.wrappedValue = false
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func choice(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(OMFont.body(15, weight: .medium))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(
                    Capsule().fill(isOn ? OMColor.plum.opacity(0.16) : OMColor.surfaceSunken)
                )
                .overlay(
                    Capsule().stroke(isOn ? OMColor.plum : Color.clear, lineWidth: 1.5)
                )
                .foregroundStyle(isOn ? OMColor.plum : OMColor.ink)
        }
        .buttonStyle(.plain)
    }
}
