import SwiftUI


@MainActor
final class ChatListViewModel: ObservableObject {
    @Published var matches: [MatchDTO] = []
    @Published var error: String?
    var api: APIClient?

    func load() async {
        guard let api else { return }
        do { matches = try await api.matches() } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ChatListView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = ChatListViewModel()

    var body: some View {
        NavigationStack {
            OMScreen {
                ScrollView {
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
                                        MatchRow(match: match, peerName: peerName(match))
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
}

private struct MatchRow: View {
    let match: MatchDTO
    let peerName: String
    var body: some View {
        HStack(spacing: OMSpacing.md) {
            BotanicPlaceholder(.avatar(44))
            VStack(alignment: .leading, spacing: 2) {
                Text(peerName)
                    .font(OMFont.body(16, weight: .semibold))
                    .foregroundStyle(OMColor.ink)
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
