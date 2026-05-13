import SwiftUI

struct OnboardingFlowView: View {
    let userId: String
    @EnvironmentObject private var appState: AppState
    @State private var step = 0

    var body: some View {
        VStack {
            switch step {
            case 0:
                StepBasics(onNext: { step += 1 })
            case 1:
                StepAgeGate(onNext: { step += 1 })
            case 2:
                StepLikesVisibility(onNext: { step += 1 })
            default:
                StepDone(onFinish: { appState.didSignIn(userId: userId) })
            }
        }
        .animation(.easeInOut, value: step)
    }
}

private struct StepBasics: View {
    let onNext: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Welcome").font(.largeTitle.bold())
            Text("Tell us the basics. You can change everything later. The minimum for a complete profile is two photos, a display name, and your age.")
            Button("Continue", action: onNext).buttonStyle(OMPrimaryButtonStyle())
        }
        .padding()
    }
}

// 18+ age gate.
//
// Why a DOB picker and not an "I am 18+" checkbox: case law and
// regulator practice consistently treat a checkbox as the weakest form
// of age assurance, and the AADC / UK Children's Code / DSA Art. 28
// expect more. A DOB picker is the floor.
//
// Server-side, profile.ts re-validates and refuses with HTTP 403
// "underage". Layered assurance (Apple Declared Age Range + escalation
// to document verification on signal) is tracked in compliance roadmap
// §1.3.
private struct StepAgeGate: View {
    let onNext: () -> Void
    @EnvironmentObject private var appState: AppState
    @State private var dob: Date = {
        // Default selection is 25 years ago so the picker never starts
        // on a date that would be underage (which would be a confusing
        // first read for someone who just tapped past Welcome).
        Calendar.current.date(byAdding: .year, value: -25, to: Date()) ?? Date()
    }()
    @State private var isSaving = false
    @State private var error: String?

    private var ageYears: Int {
        Calendar.current.dateComponents([.year], from: dob, to: Date()).year ?? 0
    }
    private var meetsThreshold: Bool { ageYears >= 18 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your date of birth").font(.largeTitle.bold())
            Text("OpenMatch is 18+. We never show your date of birth to other users — only your age, if you choose to display it.")
                .font(.callout).foregroundStyle(.secondary)

            DatePicker(
                "Date of birth",
                selection: $dob,
                in: ...Date(),
                displayedComponents: [.date]
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity)

            if !meetsThreshold {
                Label(
                    "OpenMatch is only available to people aged 18 or older.",
                    systemImage: "exclamationmark.shield"
                )
                .foregroundStyle(OMColor.safety)
                .font(.footnote)
            }

            if let error {
                Text(error).font(.footnote).foregroundStyle(OMColor.safety)
            }

            Button {
                Task { await submit() }
            } label: {
                if isSaving { ProgressView() } else { Text("Continue") }
            }
            .buttonStyle(OMPrimaryButtonStyle())
            .disabled(!meetsThreshold || isSaving)
        }
        .padding()
    }

    private func submit() async {
        isSaving = true; defer { isSaving = false }
        error = nil
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withFullDate]
        var patch = ProfileUpdateRequest()
        patch.dateOfBirth = iso.string(from: dob)
        do {
            _ = try await appState.api.updateProfile(patch)
            // Record ToS + privacy notice + Art. 9 consents up front;
            // each is independently recorded so withdrawals are precise.
            try? await appState.api.recordConsent(scope: "terms_of_service", granted: true)
            try? await appState.api.recordConsent(scope: "privacy_notice", granted: true)
            try? await appState.api.recordConsent(scope: "art9_processing", granted: true)
            onNext()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct StepLikesVisibility: View {
    let onNext: () -> Void
    @State private var choice: LikesVisibility = .visible
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Who liked you").font(.largeTitle.bold())
            Text("Seeing who liked you is always free. You can choose how it's shown — change anytime.")
                .font(.callout).foregroundStyle(.secondary)
            Picker("Likes visibility", selection: $choice) {
                Text("Visible").tag(LikesVisibility.visible)
                Text("Count only").tag(LikesVisibility.count_only)
                Text("Hidden").tag(LikesVisibility.hidden)
            }
            .pickerStyle(.segmented)
            Button("Continue", action: onNext).buttonStyle(OMPrimaryButtonStyle())
        }
        .padding()
    }
}

private struct StepDone: View {
    let onFinish: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 56)).foregroundStyle(OMColor.like)
            Text("You're in.").font(.largeTitle.bold())
            Text("Open the Swipe tab to start browsing. Undo, filters, and seeing likes — all free.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Start swiping", action: onFinish).buttonStyle(OMPrimaryButtonStyle())
        }
        .padding(24)
    }
}
