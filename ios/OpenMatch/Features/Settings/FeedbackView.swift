import SwiftUI
import UIKit

// IOS-4 — in-app feedback. We capture category, free-form body, and a
// few device metadata fields so we can route bugs to the right
// surface. We deliberately don't capture user identity here; the
// backend infers it from the auth header.
struct FeedbackView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.dismiss) private var dismiss

    enum Category: String, CaseIterable, Hashable {
        case bug, suggestion, praise, other

        var label: String {
            switch self {
            case .bug: return "Bug"
            case .suggestion: return "Idea"
            case .praise: return "Love"
            case .other: return "Other"
            }
        }
    }

    @State private var category: Category = .bug
    @State private var bodyText: String = ""
    @State private var isSubmitting = false
    @State private var error: String?
    @State private var didSubmit = false

    private var canSubmit: Bool {
        !bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    var body: some View {
        OMScreen {
            ScrollView {
                LazyVStack(spacing: OMSpacing.xl) {
                    OMSection("What kind of feedback?") {
                        OMSegmented(
                            selection: $category,
                            options: Category.allCases.map { (label: $0.label, value: $0) }
                        )
                        .padding(.horizontal, OMSpacing.lg)
                        .padding(.vertical, 12)
                    }

                    OMSection(
                        "Tell us more",
                        footer: "We read every note. Bugs go straight to engineering; ideas land in our weekly planning."
                    ) {
                        TextEditor(text: $bodyText)
                            .frame(minHeight: 160)
                            .font(OMFont.bodyRegular)
                            .padding(.horizontal, OMSpacing.lg)
                            .padding(.vertical, 12)
                            .scrollContentBackground(.hidden)
                    }

                    if didSubmit {
                        Text("Thanks — we got it.")
                            .font(OMFont.callout.weight(.semibold))
                            .foregroundStyle(OMColor.plum)
                            .frame(maxWidth: .infinity)
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView().tint(OMColor.onAccent)
                        } else {
                            Text(didSubmit ? "Send another" : "Send feedback")
                        }
                    }
                    .buttonStyle(OMPrimaryButtonStyle())
                    .disabled(!canSubmit)

                    if let error {
                        Text(error)
                            .font(OMFont.caption)
                            .foregroundStyle(OMColor.cinnabar)
                            .multilineTextAlignment(.center)
                    }

                    Text("Build \(Self.appVersion()) · iOS \(UIDevice.current.systemVersion) · \(UIDevice.current.model)")
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Send feedback")
    }

    private func submit() async {
        isSubmitting = true
        defer { isSubmitting = false }
        error = nil
        let text = bodyText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await api.submitFeedback(category: category.rawValue, body: text)
            await Analytics.shared.record(
                "feedback.submitted",
                ["category": .s(category.rawValue), "len": .i(text.count)]
            )
            bodyText = ""
            didSubmit = true
        } catch {
            // Feedback is fire-and-forget for the user; surface a
            // friendly message but don't block them — the alternative
            // is they walk away annoyed.
            self.error = "We couldn't send that just now. Please try again in a moment."
        }
    }

    private static func appVersion() -> String {
        let short = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "?"
        let build = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
        return "\(short) (\(build))"
    }
}
