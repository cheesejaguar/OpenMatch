import SwiftUI

struct SettingsView: View {
    var body: some View {
        Form {
            Section("Discovery") {
                NavigationLink("Looking for") { LookingForView() }
            }
            Section("Privacy") {
                Toggle("Show approximate location", isOn: .constant(true)).disabled(true)
                Toggle("Show online status", isOn: .constant(false))
            }
            Section("Notifications") {
                Toggle("Matches",  isOn: .constant(true))
                Toggle("Messages", isOn: .constant(true))
                Toggle("Likes",    isOn: .constant(true))
            }
            Section("Account") {
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

struct ExportDataView: View {
    var body: some View {
        Text("Your data export will be emailed to you within 7 days.")
            .padding()
            .navigationTitle("Export data")
    }
}

struct DeleteAccountView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Deleting your account removes your profile from discovery immediately and erases your photos, preferences, and matches.")
                .multilineTextAlignment(.center)
            Button("Delete account", role: .destructive) {}
                .buttonStyle(.borderedProminent).tint(OMColor.safety)
        }
        .padding()
        .navigationTitle("Delete account")
    }
}
