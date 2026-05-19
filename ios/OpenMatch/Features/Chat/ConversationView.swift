import SwiftUI


// A row in the chat scroll view. `.server` is a server-authoritative
// MessageDTO; `.pending` is an optimistic local row backed by the
// MessageQueue and shown with a spinner / retry affordance.
enum ConversationRow: Identifiable {
    case server(MessageDTO)
    case pending(PendingMessage)

    var id: String {
        switch self {
        case .server(let m): return "s:\(m.id)"
        case .pending(let p): return "p:\(p.id.uuidString)"
        }
    }
}

@MainActor
final class ConversationViewModel: ObservableObject {
    @Published var messages: [MessageDTO] = []
    @Published var pending: [PendingMessage] = []
    @Published var draft: String = ""
    @Published var error: String?
    let conversationId: String
    var api: APIClient?

    private var realtimeSubscription: RealtimeSubscription?
    private let queue: MessageQueue

    init(
        conversationId: String,
        queue: MessageQueue = MessageQueue.shared
    ) {
        self.conversationId = conversationId
        self.queue = queue
        // Mirror the queue's pending list (scoped to this conversation)
        // into our @Published state so SwiftUI re-renders on changes.
        self.pending = queue.pending.filter { $0.conversationId == conversationId }
        attachQueueCallbacks()
    }

    deinit {
        realtimeSubscription?.cancel()
    }

    func load() async {
        guard let api else { return }
        do { messages = try await api.messages(conversationId: conversationId) } catch {
            self.error = error.localizedDescription
        }
    }

    // Open the Ably channel for this conversation. The handler dedupes by
    // message id so the REST round-trip's optimistic append doesn't double
    // when the publish webhook arrives first.
    func attachRealtime() {
        realtimeSubscription?.cancel()
        realtimeSubscription = RealtimeService.shared.subscribe(
            conversationId: conversationId
        ) { [weak self] msg in
            guard let self else { return }
            if self.messages.contains(where: { $0.id == msg.id }) { return }
            self.messages.append(msg)
        }
    }

    func detachRealtime() {
        realtimeSubscription?.cancel()
        realtimeSubscription = nil
    }

    // Wire the queue's delivery callbacks so the optimistic row vanishes
    // and the canonical DTO appears in its place when the server accepts
    // a message. We also mirror the pending list back to @Published.
    private func attachQueueCallbacks() {
        queue.onDelivered = { [weak self] _, dto in
            guard let self else { return }
            if !self.messages.contains(where: { $0.id == dto.id }) {
                self.messages.append(dto)
            }
            self.refreshPending()
        }
        queue.onPermanentFailure = { [weak self] item in
            guard let self else { return }
            self.error = "Couldn't deliver: \(item.lastError ?? "unknown error")"
            self.refreshPending()
        }
    }

    private func refreshPending() {
        self.pending = queue.pending.filter { $0.conversationId == conversationId }
    }

    // Enqueue the current draft and kick the queue. Called from the
    // send button's tap action. The optimistic row appears immediately
    // because `pending` is mirrored from the queue.
    func enqueueDraft() {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        draft = ""
        _ = queue.enqueue(conversationId: conversationId, body: body)
        refreshPending()
        Task { [weak self] in
            guard let self, let api = self.api else { return }
            await self.queue.attemptDeliver(api: api)
            self.refreshPending()
        }
    }

    // Manual retry from the "Tap to retry" affordance. Resets the
    // backoff window so the next deliver pass picks it up immediately.
    func retry(_ id: UUID) {
        queue.retry(id)
        refreshPending()
        Task { [weak self] in
            guard let self, let api = self.api else { return }
            await self.queue.attemptDeliver(api: api)
            self.refreshPending()
        }
    }

    // Discard a permanently-failed row (user tap on the "x" affordance).
    func discard(_ id: UUID) {
        queue.discard(id)
        refreshPending()
    }

    // Driven by the 10-second timer in ConversationView and by the
    // scene-foreground notification. Pulls REST state and gives the
    // queue a chance to flush.
    func tick() async {
        guard let api else { return }
        await queue.attemptDeliver(api: api)
        refreshPending()
    }

    // Triggered on background → foreground transition. Ably may have
    // dropped publishes while we were suspended; re-pull the canonical
    // message list and then retry any pending sends.
    func refreshAfterForeground() async {
        await load()
        await tick()
    }

    // The full ordered row list. Pending rows are appended after server
    // rows; SwiftUI keys by ConversationRow.id so the swap from pending
    // → server is animation-friendly.
    var rows: [ConversationRow] {
        let server = messages.map { ConversationRow.server($0) }
        let pendingRows = pending.map { ConversationRow.pending($0) }
        return server + pendingRows
    }

    // Back-compat shim used by older callers / tests. New code paths
    // should call `enqueueDraft()` directly.
    func send() async {
        enqueueDraft()
    }
}

struct ConversationView: View {
    @EnvironmentObject private var api: APIClient
    let conversationId: String
    let title: String
    @StateObject private var vm: ConversationViewModel
    @State private var pollTask: Task<Void, Never>?

    init(conversationId: String, title: String) {
        self.conversationId = conversationId
        self.title = title
        _vm = StateObject(wrappedValue: ConversationViewModel(conversationId: conversationId))
    }

    var body: some View {
        OMScreen {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(vm.rows) { row in
                                rowView(row)
                                    .id(row.id)
                            }
                        }
                        .padding(OMSpacing.lg)
                    }
                    .onChange(of: vm.rows.count) { _, _ in
                        if let last = vm.rows.last?.id {
                            withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                        }
                    }
                }

                Rectangle()
                    .fill(OMColor.divider)
                    .frame(height: 1)

                HStack(spacing: OMSpacing.sm) {
                    TextField("Message", text: $vm.draft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(1...4)
                        .font(OMFont.bodyRegular)
                        .padding(.horizontal, OMSpacing.md)
                        .padding(.vertical, 8)
                        .background(
                            OMShape.chip().fill(OMColor.surfaceSunken)
                        )
                    Button {
                        vm.enqueueDraft()
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .padding(10)
                            .background(OMColor.magenta, in: Circle())
                            .foregroundStyle(OMColor.onAccent)
                    }
                    .disabled(vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Send message")
                }
                .padding(12)
                .background(OMColor.surfaceElevated)
            }
        }
        .omNavTitle(title)
        .task {
            vm.api = api
            vm.attachRealtime()
            await vm.load()
            // Give the queue a chance to flush any messages that were
            // persisted across a force-quit before we got here.
            await vm.tick()
            startPolling()
        }
        .onDisappear {
            vm.detachRealtime()
            pollTask?.cancel()
            pollTask = nil
        }
        // Background → foreground: Ably may have missed publishes while
        // suspended, so re-pull REST and retry any pending sends.
        .onReceive(NotificationCenter.default.publisher(for: .openMatchDidForeground)) { _ in
            Task { await vm.refreshAfterForeground() }
        }
        .alert("Message error", isPresented: .init(
            get: { vm.error != nil },
            set: { _ in vm.error = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.error ?? "")
        }
    }

    @ViewBuilder
    private func rowView(_ row: ConversationRow) -> some View {
        switch row {
        case .server(let m):
            MessageBubble(
                isMine: m.senderUserId == api.cachedUserId,
                text: m.body,
                state: .sent
            )
        case .pending(let p):
            // Optimistic row. Always "mine" — only the local user can
            // enqueue a pending message.
            MessageBubble(
                isMine: true,
                text: p.body,
                state: p.lastError == nil ? .sending : .failed
            )
            .onTapGesture {
                if p.lastError != nil { vm.retry(p.id) }
            }
            .accessibilityLabel(
                p.lastError == nil
                    ? Text("Sending message")
                    : Text("Message failed. Tap to retry.")
            )
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak vm] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10 * 1_000_000_000)
                if Task.isCancelled { return }
                await vm?.tick()
            }
        }
    }
}

private struct MessageBubble: View {
    enum State { case sent, sending, failed }
    let isMine: Bool
    let text: String
    let state: State

    var body: some View {
        HStack {
            if isMine { Spacer(minLength: 40) }
            HStack(spacing: 6) {
                Text(text)
                    .font(OMFont.bodyRegular)
                if isMine {
                    switch state {
                    case .sent:
                        EmptyView()
                    case .sending:
                        ProgressView()
                            .controlSize(.mini)
                            .tint(OMColor.onAccent)
                    case .failed:
                        Image(systemName: "arrow.clockwise.circle.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(OMColor.magenta)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                bubbleBackground,
                in: OMShape.card(OMRadius.md)
            )
            .foregroundStyle(isMine ? OMColor.onAccent : OMColor.ink)
            .overlay(
                OMShape.card(OMRadius.md)
                    .stroke(isMine ? Color.clear : OMColor.cardStroke, lineWidth: 1)
            )
            .frame(maxWidth: 280, alignment: isMine ? .trailing : .leading)
            if !isMine { Spacer(minLength: 40) }
        }
    }

    private var bubbleBackground: Color {
        if !isMine { return OMColor.surfaceElevated }
        switch state {
        case .sent, .sending: return OMColor.plum
        case .failed: return OMColor.magenta.opacity(0.85)
        }
    }
}
