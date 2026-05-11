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

@MainActor
final class BlockedUsersViewModel: ObservableObject {
    @Published var blocked: [BlockedUserDTO] = []
    @Published var isLoading = false
    @Published var error: String?
    var api: APIClient?

    func load() async {
        guard let api else { return }
        isLoading = true
        defer { isLoading = false }
        do { blocked = try await api.blockedUsers() }
        catch { self.error = error.localizedDescription }
    }

    func unblock(_ b: BlockedUserDTO) async {
        guard let api else { return }
        do {
            try await api.unblock(userId: b.blockedUserId)
            blocked.removeAll { $0.id == b.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct BlockedUsersView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = BlockedUsersViewModel()

    var body: some View {
        Group {
            if vm.isLoading && vm.blocked.isEmpty {
                ProgressView()
            } else if vm.blocked.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "hand.raised.fill").font(.largeTitle).foregroundStyle(.secondary)
                    Text("No blocked users").font(.headline)
                    Text("Anyone you block will appear here. You can unblock them at any time.")
                        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding()
            } else {
                List {
                    ForEach(vm.blocked) { b in
                        HStack {
                            VStack(alignment: .leading) {
                                Text("User \(b.blockedUserId.prefix(8))").font(.body)
                                Text("Blocked \(b.createdAt.formatted(date: .abbreviated, time: .omitted))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Unblock") {
                                Task { await vm.unblock(b) }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
            }
        }
        .navigationTitle("Blocked users")
        .task {
            vm.api = api
            await vm.load()
        }
        .refreshable { await vm.load() }
        .alert("Couldn't load", isPresented: .init(
            get: { vm.error != nil },
            set: { _ in vm.error = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.error ?? "")
        }
    }
}

struct SafetyActions: View {
    @EnvironmentObject private var api: APIClient
    let profileId: String
    // The block API takes a user id; SafetyActions is given a profileId for
    // routing/UI but needs the underlying userId to actually invoke /block.
    let userId: String
    var onBlocked: (() -> Void)?

    @State private var showingReport = false
    @State private var showingBlock = false
    @State private var blockError: String?

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
            ReportFlowView(reportedUserId: userId, reportedProfileId: profileId)
        }
        .confirmationDialog(
            "Block this user?",
            isPresented: $showingBlock
        ) {
            Button("Block", role: .destructive) {
                Task {
                    do {
                        try await api.block(userId: userId)
                        onBlocked?()
                    } catch {
                        blockError = error.localizedDescription
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("They won't be able to see you. You won't see them. Any active match will end.")
        }
        .alert("Couldn't block", isPresented: .init(
            get: { blockError != nil },
            set: { _ in blockError = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(blockError ?? "")
        }
    }
}

struct ReportFlowView: View {
    @EnvironmentObject private var api: APIClient
    let reportedUserId: String
    let reportedProfileId: String?

    @Environment(\.dismiss) private var dismiss
    @State private var reason = "harassment"
    @State private var details = ""
    @State private var isSubmitting = false
    @State private var error: String?

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
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting { ProgressView() } else { Text("Submit report") }
                    }
                    .buttonStyle(OMPrimaryButtonStyle())
                    .disabled(isSubmitting)
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
            .alert("Couldn't submit", isPresented: .init(
                get: { error != nil },
                set: { _ in error = nil }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func submit() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await api.report(
                reportedUserId: reportedUserId,
                reason: reason,
                details: details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : details
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
