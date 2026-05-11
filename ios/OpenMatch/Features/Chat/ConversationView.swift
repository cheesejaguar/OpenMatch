import SwiftUI


final class ConversationViewModel: ObservableObject {
    @Published var messages: [MessageDTO] = []
    @Published var draft: String = ""
    @Published var error: String?
    let conversationId: String
    private let api: APIClient
    init(api: APIClient, conversationId: String) {
        self.api = api
        self.conversationId = conversationId
    }

    func load() async {
        do { messages = try await api.messages(conversationId: conversationId) } catch {
            self.error = error.localizedDescription
        }
    }

    func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        draft = ""
        do {
            let msg = try await api.sendMessage(conversationId: conversationId, body: body)
            messages.append(msg)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ConversationView: View {
    @EnvironmentObject private var api: APIClient
    let conversationId: String
    let title: String
    @StateObject private var vm: ConversationViewModel

    init(conversationId: String, title: String) {
        self.conversationId = conversationId
        self.title = title
        _vm = StateObject(
            wrappedValue: ConversationViewModel(
                api: APIClient(baseURL: APIConfig.defaultBaseURL),
                conversationId: conversationId
            )
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(vm.messages) { m in
                            MessageBubble(
                                isMine: m.senderUserId == api.cachedUserId,
                                text: m.body
                            )
                            .id(m.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: vm.messages.count) { _, _ in
                    if let last = vm.messages.last?.id {
                        withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                    }
                }
            }

            HStack(spacing: 8) {
                TextField("Message", text: $vm.draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                Button {
                    Task { await vm.send() }
                } label: {
                    Image(systemName: "paperplane.fill")
                        .padding(10)
                        .background(OMColor.like, in: Circle())
                        .foregroundStyle(.white)
                }
                .disabled(vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Send message")
            }
            .padding(12)
            .background(.thinMaterial)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
    }
}

private struct MessageBubble: View {
    let isMine: Bool
    let text: String
    var body: some View {
        HStack {
            if isMine { Spacer(minLength: 40) }
            Text(text)
                .padding(10)
                .background(
                    isMine ? OMColor.like.opacity(0.95) : OMColor.surfaceMuted,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
                .foregroundStyle(isMine ? .white : .primary)
                .frame(maxWidth: 280, alignment: isMine ? .trailing : .leading)
            if !isMine { Spacer(minLength: 40) }
        }
    }
}
