import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Form {
            Section("Discovery") {
                NavigationLink("Looking for") { LookingForView() }
            }
            Section("Privacy") {
                NavigationLink("Notifications") {
                    NotificationPreferencesView()
                }
                Toggle("Show approximate location", isOn: .constant(true)).disabled(true)
                Toggle("Show online status", isOn: .constant(false))
            }
            Section("My data") {
                NavigationLink("Export my data") { ExportDataView() }
                NavigationLink("Delete account") { DeleteAccountView() }
            }
            Section("Algorithm") {
                NavigationLink("How does ranking work?") { AlgorithmView() }
            }
            Section {
                Text("OpenMatch will never ask you to pay for likes, undo, or visibility. This setting screen is intentionally short.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
    }
}

// MARK: - Data export

struct ExportDataView: View {
    @EnvironmentObject private var appState: AppState
    @State private var exportURL: URL?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 14) {
            Text("Get a copy of everything OpenMatch holds about you — your profile, photos (as URLs), preferences, swipes, likes, messages you sent, reports you filed, and your consent history.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            if let exportURL {
                ShareLink(item: exportURL) {
                    Label("Save my data", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(OMPrimaryButtonStyle())
            } else if isLoading {
                ProgressView("Preparing your export…")
            } else {
                Button {
                    Task { await fetch() }
                } label: {
                    Label("Prepare my data export", systemImage: "tray.and.arrow.down")
                }
                .buttonStyle(OMPrimaryButtonStyle())
            }

            if let error {
                Text(error).font(.footnote).foregroundStyle(OMColor.safety)
            }

            Text("Exports are rate-limited to a few per hour. Photos are included as URLs you can re-download.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding()
        .navigationTitle("Export data")
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
        Form {
            if let existing {
                Section("Deletion scheduled") {
                    LabeledContent("Status", value: existing.status.capitalized)
                    LabeledContent("Restorable until", value: existing.gracePeriodEndsAt.formatted())
                    Button("Cancel deletion") { Task { await cancel() } }
                        .disabled(isWorking)
                }
            } else {
                Section {
                    Text("Deleting your account removes your profile from discovery immediately. After a 24-hour grace period (in case you change your mind), your photos, swipes, likes, and the messages you sent are erased. Matches see a tombstone of your name.")
                        .multilineTextAlignment(.leading)
                    Text("We keep the minimum needed for fraud and safety, per our Privacy Notice retention policy.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Toggle("I understand this cannot be undone after 24 hours.", isOn: $confirm)
                    Button(role: .destructive) {
                        Task { await delete() }
                    } label: {
                        Label("Delete my account", systemImage: "trash")
                    }
                    .disabled(!confirm || isWorking)
                }
            }
            if let error {
                Section {
                    Text(error).foregroundStyle(OMColor.safety)
                }
            }
        }
        .navigationTitle("Delete account")
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
        Form {
            if let prefs = Binding($prefs) {
                Section("Transactional (privacy-preserving)") {
                    Toggle("New matches", isOn: prefs.newMatchPush)
                    Toggle("New messages", isOn: prefs.newMessagePush)
                    Toggle("New likes", isOn: prefs.newLikePush)
                    Toggle("Safety alerts", isOn: prefs.safetyPush)
                    Picker("Push notification preview", selection: prefs.pushPreviewMode) {
                        Text("Full content").tag("full")
                        Text("Sender only").tag("sender_only")
                        Text("Hidden").tag("hidden")
                    }
                }
                Section("Product news") {
                    Toggle("Email", isOn: prefs.productNewsEmail)
                    Toggle("Push", isOn: prefs.productNewsPush)
                    Toggle("SMS", isOn: prefs.productNewsSms)
                    Text("Off by default. You can opt in or out at any time. We never share your contact details.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button("Save") { Task { await save() } }
            } else {
                ProgressView()
            }
            if let error {
                Text(error).foregroundStyle(OMColor.safety)
            }
        }
        .navigationTitle("Notifications")
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
