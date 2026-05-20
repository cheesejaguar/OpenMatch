import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var handedness: HandednessStore

    var body: some View {
        OMScreen {
            ScrollView {
                LazyVStack(spacing: OMSpacing.xl) {
                    OMSection("Discovery") {
                        NavigationLink {
                            LookingForView()
                        } label: {
                            OMRow("Looking for", systemImage: "slider.horizontal.3", chevron: true)
                        }
                        .buttonStyle(.plain)
                    }

                    OMSection("Privacy") {
                        NavigationLink {
                            NotificationPreferencesView()
                        } label: {
                            OMRow("Notifications", systemImage: "bell.badge", chevron: true)
                        }
                        .buttonStyle(.plain)
                        OMSectionDivider()
                        OMToggle(
                            label: "Show approximate location",
                            caption: "Your exact coordinates are never shared.",
                            isOn: .constant(true)
                        )
                        .disabled(true)
                        OMSectionDivider()
                        OMToggle(label: "Show online status", isOn: .constant(false))
                    }

                    OMSection("My data") {
                        NavigationLink {
                            ExportDataView()
                        } label: {
                            OMRow("Export my data", systemImage: "square.and.arrow.down", chevron: true)
                        }
                        .buttonStyle(.plain)
                        OMSectionDivider()
                        NavigationLink {
                            DeleteAccountView()
                        } label: {
                            OMRow("Delete account", systemImage: "trash", iconTint: OMColor.safetyRed, chevron: true)
                        }
                        .buttonStyle(.plain)
                    }

                    OMSection("Accessibility") {
                        OMPicker(
                            label: "Thumb reach",
                            selection: Binding(
                                get: { handedness.current },
                                set: { handedness.current = $0 }
                            ),
                            options: [
                                (label: "Right", value: Handedness.right),
                                (label: "Left", value: Handedness.left),
                                (label: "Center", value: Handedness.center),
                            ]
                        )
                    }

                    OMSection("Algorithm") {
                        NavigationLink {
                            AlgorithmView()
                        } label: {
                            OMRow("How does ranking work?", systemImage: "doc.text.magnifyingglass", chevron: true)
                        }
                        .buttonStyle(.plain)
                    }

                    OMSection("Beta") {
                        NavigationLink {
                            FeedbackView()
                        } label: {
                            OMRow("Send feedback", systemImage: "envelope.open", chevron: true)
                        }
                        .buttonStyle(.plain)
                    }

                    Text("OpenMatch will never ask you to pay for likes, undo, or visibility. This screen is intentionally short.")
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, OMSpacing.lg)
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Settings")
    }
}

// MARK: - Data export

struct ExportDataView: View {
    @EnvironmentObject private var appState: AppState
    @State private var exportURL: URL?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        OMScreen {
            ScrollView {
                VStack(spacing: OMSpacing.lg) {
                    BotanicPlaceholder(.avatar(80))
                    Text("Get a copy of everything OpenMatch holds about you — your profile, photos (as URLs), preferences, swipes, likes, messages you sent, reports you filed, and your consent history.")
                        .multilineTextAlignment(.center)
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)

                    if let exportURL {
                        ShareLink(item: exportURL) {
                            Label("Save my data", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(OMPrimaryButtonStyle())
                    } else if isLoading {
                        ProgressView("Preparing your export…")
                            .tint(OMColor.moss)
                    } else {
                        Button {
                            Task { await fetch() }
                        } label: {
                            Label("Prepare my data export", systemImage: "tray.and.arrow.down")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(OMPrimaryButtonStyle())
                    }

                    if let error {
                        Text(error)
                            .font(OMFont.caption)
                            .foregroundStyle(OMColor.safetyRed)
                    }

                    Text("Exports are rate-limited to a few per hour. Photos are included as URLs you can re-download.")
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                        .multilineTextAlignment(.center)
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Export data")
    }

    private func fetch() async {
        isLoading = true; defer { isLoading = false }
        error = nil
        do {
            let data = try await appState.api.privacyExport()
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("openmatch-export-\(Int(Date().timeIntervalSince1970)).json")
            try data.write(to: url)
            exportURL = url
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Account deletion

struct DeleteAccountView: View {
    @EnvironmentObject private var appState: AppState
    @State private var existing: AccountDeletionStatusDTO?
    @State private var isWorking = false
    @State private var error: String?
    @State private var confirm = false

    var body: some View {
        OMScreen {
            ScrollView {
                LazyVStack(spacing: OMSpacing.xl) {
                    if let existing {
                        OMSection("Deletion scheduled") {
                            HStack {
                                Text("Status")
                                    .font(OMFont.body(15, weight: .medium))
                                    .foregroundStyle(OMColor.ink)
                                Spacer()
                                Text(existing.status.capitalized)
                                    .font(OMFont.body(15, weight: .semibold))
                                    .foregroundStyle(OMColor.moss)
                            }
                            .padding(.horizontal, OMSpacing.lg)
                            .padding(.vertical, 12)
                            OMSectionDivider()
                            HStack {
                                Text("Restorable until")
                                    .font(OMFont.body(15, weight: .medium))
                                    .foregroundStyle(OMColor.ink)
                                Spacer()
                                Text(existing.gracePeriodEndsAt.formatted())
                                    .font(OMFont.caption)
                                    .foregroundStyle(OMColor.inkMuted)
                            }
                            .padding(.horizontal, OMSpacing.lg)
                            .padding(.vertical, 12)
                        }
                        Button("Cancel deletion") { Task { await cancel() } }
                            .buttonStyle(OMSecondaryButtonStyle())
                            .disabled(isWorking)
                    } else {
                        OMSection {
                            Text("Deleting your account removes your profile from discovery immediately. After a 24-hour grace period (in case you change your mind), your photos, swipes, likes, and the messages you sent are erased. Matches see a tombstone of your name.")
                                .font(OMFont.callout)
                                .foregroundStyle(OMColor.ink)
                                .padding(OMSpacing.lg)
                            OMSectionDivider()
                            Text("We keep the minimum needed for fraud and safety, per our Privacy Notice retention policy.")
                                .font(OMFont.caption)
                                .foregroundStyle(OMColor.inkMuted)
                                .padding(OMSpacing.lg)
                        }

                        OMSection {
                            OMToggle(
                                label: "I understand this cannot be undone after 24 hours.",
                                isOn: $confirm
                            )
                        }

                        Button(role: .destructive) {
                            Task { await delete() }
                        } label: {
                            Label("Delete my account", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(OMDestructiveButtonStyle())
                        .disabled(!confirm || isWorking)
                    }
                    if let error {
                        Text(error)
                            .font(OMFont.caption)
                            .foregroundStyle(OMColor.safetyRed)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Delete account")
        .task { await refresh() }
    }

    private func refresh() async {
        do { existing = try await appState.api.currentAccountDeletion() } catch { }
    }

    private func delete() async {
        isWorking = true; defer { isWorking = false }
        error = nil
        do {
            existing = try await appState.api.scheduleAccountDeletion(reason: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func cancel() async {
        isWorking = true; defer { isWorking = false }
        error = nil
        do {
            try await appState.api.cancelAccountDeletion()
            existing = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Notification preferences (CASL / CAN-SPAM / TCPA-aligned)

struct NotificationPreferencesView: View {
    @EnvironmentObject private var appState: AppState
    @State private var prefs: NotificationPreferencesDTO?
    @State private var error: String?

    var body: some View {
        OMScreen {
            ScrollView {
                LazyVStack(spacing: OMSpacing.xl) {
                    if let prefs = Binding($prefs) {
                        OMSection("Transactional (privacy-preserving)") {
                            OMToggle(label: "New matches", isOn: prefs.newMatchPush)
                            OMSectionDivider()
                            OMToggle(label: "New messages", isOn: prefs.newMessagePush)
                            OMSectionDivider()
                            OMToggle(label: "New likes", isOn: prefs.newLikePush)
                            OMSectionDivider()
                            OMToggle(label: "Safety alerts", isOn: prefs.safetyPush)
                            OMSectionDivider()
                            OMPicker(
                                label: "Notification preview",
                                selection: prefs.pushPreviewMode,
                                options: [
                                    (label: "Full content", value: "full"),
                                    (label: "Sender only", value: "sender_only"),
                                    (label: "Hidden", value: "hidden"),
                                ]
                            )
                        }

                        OMSection("Product news", footer: "Off by default. You can opt in or out at any time. We never share your contact details.") {
                            OMToggle(label: "Email", isOn: prefs.productNewsEmail)
                            OMSectionDivider()
                            OMToggle(label: "Push", isOn: prefs.productNewsPush)
                            OMSectionDivider()
                            OMToggle(label: "SMS", isOn: prefs.productNewsSms)
                        }

                        Button("Save") { Task { await save() } }
                            .buttonStyle(OMPrimaryButtonStyle())
                    } else {
                        ProgressView()
                            .tint(OMColor.moss)
                            .padding(.top, 80)
                    }
                    if let error {
                        Text(error)
                            .font(OMFont.caption)
                            .foregroundStyle(OMColor.safetyRed)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Notifications")
        .task { await load() }
    }

    private func load() async {
        do { prefs = try await appState.api.notificationPreferences() } catch {
            self.error = error.localizedDescription
        }
    }

    private func save() async {
        guard let prefs else { return }
        do {
            self.prefs = try await appState.api.updateNotificationPreferences(prefs)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
