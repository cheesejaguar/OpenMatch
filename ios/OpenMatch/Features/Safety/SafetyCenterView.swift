import SwiftUI

struct SafetyCenterView: View {
    var body: some View {
        List {
            Section("Reporting & blocking") {
                Text("Tap **Report** or **Block** on any profile or message. Reports go to a moderator queue; blocks are immediate and two-way.")
            }
            Section("Dating safety") {
                Label("Meet in public places for the first time.", systemImage: "person.2.fill")
                Label("Tell a friend where you're going.", systemImage: "bubble.left.fill")
                Label("Trust your instincts. Unmatch or block without explanation.", systemImage: "hand.raised.fill")
                Label("OpenMatch will NEVER ask for money or gift cards.", systemImage: "exclamationmark.shield.fill")
                    .foregroundStyle(OMColor.safety)
            }
            Section("Crisis resources") {
                Link("RAINN — National Sexual Assault Hotline", destination: URL(string: "https://www.rainn.org/")!)
                Link("Crisis Text Line", destination: URL(string: "https://www.crisistextline.org/")!)
                Text("In immediate danger, contact your local emergency services.")
                    .foregroundStyle(.secondary)
            }
            Section("Community guidelines") {
                Link("Read the full guidelines",
                     destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/safety/community-guidelines.md")!)
            }
        }
        .navigationTitle("Safety center")
    }
}

struct BlockedUsersView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "hand.raised.fill").font(.largeTitle).foregroundStyle(.secondary)
            Text("No blocked users").font(.headline)
            Text("Anyone you block will appear here. You can unblock them at any time.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding()
        .navigationTitle("Blocked users")
    }
}

struct SafetyActions: View {
    let profileId: String
    @State private var showingReport = false
    @State private var showingBlock = false

    var body: some View {
        HStack(spacing: 12) {
            Button(role: .destructive) {
                showingReport = true
            } label: {
                Label("Report", systemImage: "flag.fill")
            }
            .buttonStyle(.bordered)
            Button(role: .destructive) {
                showingBlock = true
            } label: {
                Label("Block", systemImage: "hand.raised.fill")
            }
            .buttonStyle(.bordered)
        }
        .sheet(isPresented: $showingReport) {
            ReportFlowView(profileId: profileId)
        }
        .confirmationDialog(
            "Block this user?",
            isPresented: $showingBlock
        ) {
            Button("Block", role: .destructive) {}
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("They won't be able to see you. You won't see them. Any active match will end.")
        }
    }
}

struct ReportFlowView: View {
    let profileId: String
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "harassment"
    @State private var details = ""

    let reasons: [(String, String)] = [
        ("harassment", "Harassment"),
        ("hate_or_discrimination", "Hate or discrimination"),
        ("threats_or_violence", "Threats or violence"),
        ("sexual_content", "Sexual content"),
        ("scam_or_spam", "Scam or spam"),
        ("fake_profile", "Fake profile"),
        ("underage", "Underage user"),
        ("impersonation", "Impersonation"),
        ("offensive_profile", "Offensive profile"),
        ("off_platform_solicitation", "Off-platform solicitation"),
        ("other", "Other")
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("Reason") {
                    Picker("Reason", selection: $reason) {
                        ForEach(reasons, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
                Section("Details (optional)") {
                    TextField("Add context", text: $details, axis: .vertical).lineLimit(3...6)
                }
                Section {
                    Button("Submit report") { dismiss() }
                        .buttonStyle(OMPrimaryButtonStyle())
                }
                Section {
                    Text("Reports go to a moderator. You won't see this profile again.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
