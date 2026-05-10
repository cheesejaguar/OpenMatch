import SwiftUI

@MainActor
final class ChatListViewModel: ObservableObject {
    @Published var matches: [MatchDTO] = []
    @Published var error: String?
    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async {
        do { matches = try await api.matches() } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ChatListView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm: ChatListViewModel

    init() {
        _vm = StateObject(wrappedValue: ChatListViewModel(api: APIClient(baseURL: APIConfig.defaultBaseURL)))
    }

    var body: some View {
        NavigationStack {
            List {
                if vm.matches.isEmpty {
                    Section {
                        VStack(spacing: 8) {
                            Image(systemName: "bubble.left.and.bubble.right")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                            Text("No conversations yet")
                                .font(.headline)
                            Text("Match with someone in the Swipe tab to start a chat.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 30)
                    }
                } else {
                    Section("Matches") {
                        ForEach(vm.matches) { match in
                            NavigationLink {
                                if let conv = match.conversation {
                                    ConversationView(conversationId: conv.id, title: peerName(match))
                                }
                            } label: {
                                MatchRow(match: match)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Chat")
            .task { await vm.load() }
            .refreshable { await vm.load() }
        }
    }

    private func peerName(_ match: MatchDTO) -> String {
        let me = api.cachedUserId
        if match.userA.id == me {
            return match.userB.profile?.displayName ?? "Match"
        }
        return match.userA.profile?.displayName ?? "Match"
    }
}

private struct MatchRow: View {
    let match: MatchDTO
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(OMColor.surfaceMuted).frame(width: 44, height: 44)
                .overlay(Image(systemName: "person.fill").foregroundStyle(.secondary))
            VStack(alignment: .leading, spacing: 2) {
                Text(match.userB.profile?.displayName ?? "Match")
                    .font(.headline)
                Text(match.conversation?.messages?.first?.body ?? "Say hi!")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }
}
