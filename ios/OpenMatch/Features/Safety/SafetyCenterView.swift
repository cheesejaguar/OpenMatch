import SwiftUI

struct SafetyCenterView: View {
    var body: some View {
        OMScreen {
            ScrollView {
                LazyVStack(spacing: OMSpacing.xl) {
                    OMSection("Reporting & blocking") {
                        Text("Tap **Report** or **Block** on any profile or message. Reports go to a moderator queue; blocks are immediate and two-way.")
                            .font(OMFont.callout)
                            .foregroundStyle(OMColor.ink)
                            .padding(OMSpacing.lg)
                    }

                    OMSection("Dating safety") {
                        SafetyTip("Meet in public places for the first time.", systemImage: "person.2.fill", tint: OMColor.moss)
                        OMSectionDivider()
                        SafetyTip("Tell a friend where you're going.", systemImage: "bubble.left.fill", tint: OMColor.moss)
                        OMSectionDivider()
                        SafetyTip("Trust your instincts. Unmatch or block without explanation.", systemImage: "hand.raised.fill", tint: OMColor.moss)
                        OMSectionDivider()
                        SafetyTip("OpenMatch will NEVER ask for money or gift cards.", systemImage: "exclamationmark.shield.fill", tint: OMColor.safetyRed)
                    }

                    OMSection("Crisis resources") {
                        Link(destination: URL(string: "https://www.rainn.org/")!) {
                            OMRow("RAINN — National Sexual Assault Hotline", systemImage: "phone.fill", chevron: true)
                        }
                        OMSectionDivider()
                        Link(destination: URL(string: "https://www.crisistextline.org/")!) {
                            OMRow("Crisis Text Line", systemImage: "message.fill", chevron: true)
                        }
                        OMSectionDivider()
                        Text("In immediate danger, contact your local emergency services.")
                            .font(OMFont.callout)
                            .foregroundStyle(OMColor.inkMuted)
                            .padding(OMSpacing.lg)
                    }

                    OMSection("Community guidelines") {
                        Link(destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/safety/community-guidelines.md")!) {
                            OMRow("Read the full guidelines", systemImage: "doc.text", chevron: true)
                        }
                    }
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Safety center")
    }
}

private struct SafetyTip: View {
    let text: String
    let systemImage: String
    let tint: Color
    init(_ text: String, systemImage: String, tint: Color) {
        self.text = text
        self.systemImage = systemImage
        self.tint = tint
    }
    var body: some View {
        HStack(spacing: OMSpacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 24)
            Text(text)
                .font(OMFont.body(15, weight: .regular))
                .foregroundStyle(OMColor.ink)
            Spacer()
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 12)
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
        OMScreen {
            ScrollView {
                if vm.isLoading && vm.blocked.isEmpty {
                    ProgressView()
                        .tint(OMColor.moss)
                        .padding(.top, 60)
                } else if vm.blocked.isEmpty {
                    VStack(spacing: OMSpacing.md) {
                        BotanicPlaceholder(.avatar(80))
                        Text("No blocked users")
                            .font(OMFont.display(22, weight: .semibold, italic: true))
                            .foregroundStyle(OMColor.ink)
                        Text("Anyone you block will appear here. You can unblock them at any time.")
                            .font(OMFont.callout)
                            .foregroundStyle(OMColor.inkMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, OMSpacing.xxl)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
                } else {
                    LazyVStack(spacing: OMSpacing.lg) {
                        OMSection {
                            ForEach(Array(vm.blocked.enumerated()), id: \.element.id) { idx, b in
                                HStack(spacing: OMSpacing.md) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("User \(b.blockedUserId.prefix(8))")
                                            .font(OMFont.body(15, weight: .semibold))
                                            .foregroundStyle(OMColor.ink)
                                        Text("Blocked \(b.createdAt.formatted(date: .abbreviated, time: .omitted))")
                                            .font(OMFont.caption)
                                            .foregroundStyle(OMColor.inkMuted)
                                    }
                                    Spacer()
                                    Button("Unblock") {
                                        Task { await vm.unblock(b) }
                                    }
                                    .buttonStyle(OMGhostButtonStyle())
                                }
                                .padding(.horizontal, OMSpacing.lg)
                                .padding(.vertical, 12)
                                if idx < vm.blocked.count - 1 { OMSectionDivider() }
                            }
                        }
                        .padding(.horizontal, OMSpacing.lg)
                    }
                    .padding(.vertical, OMSpacing.lg)
                }
            }
            .refreshable { await vm.load() }
        }
        .omNavTitle("Blocked users")
        .task {
            vm.api = api
            await vm.load()
        }
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
        HStack(spacing: OMSpacing.md) {
            Button(role: .destructive) {
                showingReport = true
            } label: {
                Label("Report", systemImage: "flag.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(OMSecondaryButtonStyle())
            Button(role: .destructive) {
                showingBlock = true
            } label: {
                Label("Block", systemImage: "hand.raised.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(OMSecondaryButtonStyle())
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
            OMScreen {
                ScrollView {
                    LazyVStack(spacing: OMSpacing.xl) {
                        OMSection("Reason") {
                            OMPicker(
                                label: "Reason",
                                selection: $reason,
                                options: reasons.map { (label: $0.1, value: $0.0) }
                            )
                        }

                        OMSection("Details (optional)") {
                            TextField("Add context", text: $details, axis: .vertical)
                                .lineLimit(3...6)
                                .textFieldStyle(.plain)
                                .font(OMFont.bodyRegular)
                                .foregroundStyle(OMColor.ink)
                                .padding(OMSpacing.lg)
                        }

                        Button {
                            Task { await submit() }
                        } label: {
                            if isSubmitting { ProgressView().tint(OMColor.onAccent) } else { Text("Submit report") }
                        }
                        .buttonStyle(OMPrimaryButtonStyle())
                        .disabled(isSubmitting)

                        Text("Reports go to a moderator. You won't see this profile again.")
                            .font(OMFont.caption)
                            .foregroundStyle(OMColor.inkMuted)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    .padding(OMSpacing.lg)
                }
            }
            .omNavTitle("Report")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(OMColor.moss)
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
