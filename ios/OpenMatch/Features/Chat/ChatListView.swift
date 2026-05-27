import SwiftUI


@MainActor
final class ChatListViewModel: ObservableObject {
    @Published var matches: [MatchDTO] = []
    @Published var pendingFeedback: [PendingDateFeedbackDTO] = []
    @Published var awaitingReply: [AwaitingReplyItemDTO] = []
    @Published var error: String?
    var api: APIClient?

    func load() async {
        guard let api else { return }
        do { matches = try await api.matches() } catch {
            self.error = error.localizedDescription
        }
        // Best-effort post-date feedback prompts (#1/#11); never block the list.
        if let pending = try? await api.pendingDateFeedback() {
            pendingFeedback = pending
        }
        // Best-effort "your turn" nudges (#7).
        if let awaiting = try? await api.conversationsAwaitingReply() {
            awaitingReply = awaiting
        }
    }

    func isAwaitingMyReply(matchId: String) -> Bool {
        awaitingReply.contains { $0.matchId == matchId }
    }
}

struct ChatListView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = ChatListViewModel()
    @State private var feedbackPrompt: PendingDateFeedbackDTO?

    var body: some View {
        NavigationStack {
            OMScreen {
                ScrollView {
                    if let first = vm.pendingFeedback.first {
                        feedbackBanner(first)
                            .padding(.horizontal, OMSpacing.lg)
                            .padding(.top, OMSpacing.lg)
                    }
                    if vm.matches.isEmpty {
                        emptyState
                            .padding(.top, 60)
                    } else {
                        LazyVStack(spacing: OMSpacing.lg) {
                            OMSection(String(localized: "chat.section.matches")) {
                                ForEach(Array(vm.matches.enumerated()), id: \.element.id) { idx, match in
                                    NavigationLink {
                                        if let conv = match.conversation {
                                            ConversationView(conversationId: conv.id, title: peerName(match))
                                        }
                                    } label: {
                                        MatchRow(
                                            match: match,
                                            peerName: peerName(match),
                                            awaitingReply: vm.isAwaitingMyReply(matchId: match.id)
                                        )
                                    }
                                    .buttonStyle(.plain)
                                    if idx < vm.matches.count - 1 {
                                        OMSectionDivider()
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, OMSpacing.lg)
                        .padding(.top, OMSpacing.lg)
                    }
                }
                .refreshable { await vm.load() }
            }
            .omNavTitle(String(localized: "chat.title"))
            .task {
                vm.api = api
                await vm.load()
            }
            .sheet(item: $feedbackPrompt) { item in
                DateFeedbackView(
                    matchId: item.matchId,
                    peerName: peerName(forUserId: item.aboutUserId)
                ) {
                    Task { await vm.load() }
                }
            }
            .alert(Text("chat.list_error.alert.title"), isPresented: .init(
                get: { vm.error != nil },
                set: { _ in vm.error = nil }
            )) {
                Button(role: .cancel) {} label: { Text("common.ok") }
            } message: {
                Text(vm.error ?? "")
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: OMSpacing.md) {
            BotanicPlaceholder(.avatar(96))
            Text("chat.empty_state.title")
                .font(OMFont.display(22, weight: .semibold, italic: true))
                .foregroundStyle(OMColor.ink)
            Text("chat.empty_state.body")
                .font(OMFont.callout)
                .foregroundStyle(OMColor.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, OMSpacing.xxl)
        }
        .frame(maxWidth: .infinity)
    }

    private func peerName(_ match: MatchDTO) -> String {
        let fallback = String(localized: "chat.row.fallback_name")
        let me = api.cachedUserId
        if match.userA.id == me {
            return match.userB.profile?.displayName ?? fallback
        }
        return match.userA.profile?.displayName ?? fallback
    }

    private func peerName(forUserId userId: String) -> String {
        let fallback = String(localized: "chat.row.fallback_name")
        for m in vm.matches {
            if m.userA.id == userId { return m.userA.profile?.displayName ?? fallback }
            if m.userB.id == userId { return m.userB.profile?.displayName ?? fallback }
        }
        return fallback
    }

    // Post-date feedback prompt (#1/#11): a gentle nudge above the matches list.
    @ViewBuilder
    private func feedbackBanner(_ item: PendingDateFeedbackDTO) -> some View {
        Button {
            feedbackPrompt = item
        } label: {
            HStack(spacing: OMSpacing.md) {
                Image(systemName: "sparkles")
                    .font(.title3)
                    .foregroundStyle(OMColor.plum)
                VStack(alignment: .leading, spacing: 2) {
                    Text("How did it go with \(peerName(forUserId: item.aboutUserId))?")
                        .font(OMFont.body(15, weight: .semibold))
                        .foregroundStyle(OMColor.ink)
                    Text("Quick, private feedback — helps us show you better matches.")
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OMColor.inkMuted)
            }
            .padding(OMSpacing.lg)
            .background(OMColor.surfaceElevated, in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }
}

private struct MatchRow: View {
    let match: MatchDTO
    let peerName: String
    var awaitingReply: Bool = false
    var body: some View {
        HStack(spacing: OMSpacing.md) {
            BotanicPlaceholder(.avatar(44))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(peerName)
                        .font(OMFont.body(16, weight: .semibold))
                        .foregroundStyle(OMColor.ink)
                    if awaitingReply {
                        Text("Your turn")
                            .font(OMFont.caption)
                            .foregroundStyle(OMColor.plum)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(OMColor.plum.opacity(0.14)))
                    }
                }
                Text(match.conversation?.messages?.first?.body
                     ?? String(localized: "chat.row.placeholder_message"))
                    .font(OMFont.callout)
                    .foregroundStyle(OMColor.inkMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OMColor.inkMuted)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}
