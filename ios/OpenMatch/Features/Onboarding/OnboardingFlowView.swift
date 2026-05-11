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
