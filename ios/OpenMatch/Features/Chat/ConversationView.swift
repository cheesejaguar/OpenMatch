import Combine
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
    // DISC-Q2 — suggested conversation-starter pills, only rendered when
    // the conversation has no messages yet. Lazily loaded once on
    // first appear; we never refresh while the user is typing.
    @Published var suggestedOpeners: [SuggestedOpenerDTO] = []
    // Typing indicator: timestamp of the most-recent typing event we
    // received from the peer. The view treats `Date().timeIntervalSince(_)
    // < 4s` as "currently typing" and re-renders every second so the
    // bubble vanishes 4s after the last keystroke.
    @Published var peerTypingAt: Date?
    // Real-time peer read marker. Used to flip the "Delivered" /
    // "Read at HH:mm" label under the latest message I sent.
    @Published var peerReadAt: Date?
    let conversationId: String
    var api: APIClient?

    private var realtimeSubscription: RealtimeSubscription?
    private let queue: MessageQueue
    // Debounce: only re-publish a typing event 300ms after the last
    // text-field change so a fast typist doesn't flood Ably.
    private var typingDebounceTask: Task<Void, Never>?
    private var lastTypingPublishedAt: Date = .distantPast

    init(
        conversationId: String,
        queue: MessageQueue = MessageQueue.shared
    ) {
        self.conversationId = conversationId
        self.queue = queue
        self.pending = queue.pending.filter { $0.conversationId == conversationId }
        attachQueueCallbacks()
    }

    deinit {
        realtimeSubscription?.cancel()
    }

    func load() async {
        guard let api else { return }
        do {
            messages = try await api.messages(conversationId: conversationId)
            peerReadAt = latestPeerReadAt(in: messages)
        } catch {
            self.error = error.localizedDescription
        }
    }

    // DISC-Q2 — fetch suggested openers on demand. We only call this
    // when the chat is empty AND we don't already have a cached set so
    // the endpoint isn't hammered. Failures are swallowed — a missing
    // pill row is not worth an alert.
    func loadSuggestedOpenersIfNeeded() async {
        guard let api else { return }
        guard messages.isEmpty else { return }
        guard suggestedOpeners.isEmpty else { return }
        do {
            let resp = try await api.suggestedOpeners(conversationId: conversationId)
            suggestedOpeners = resp.openers
        } catch {
            // Quiet failure: chat still works without pills.
        }
    }

    // Tap handler for a suggested-opener pill. We insert (not auto-send)
    // so the user can edit the text before tapping the paper-plane.
    func applySuggestedOpener(_ opener: SuggestedOpenerDTO) {
        draft = opener.text
    }

    // Convenience for the "should we render the suggestion strip"
    // predicate. True when the conversation is empty AND the user
    // hasn't typed anything yet.
    var shouldShowSuggestedOpeners: Bool {
        messages.isEmpty
            && pending.isEmpty
            && !suggestedOpeners.isEmpty
            && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // Mark every unread message from the peer as read. Called once on
    // first appear; the server fans out a `read` event so the peer's
    // bubble label flips to "Read at HH:mm".
    func markRead() async {
        guard let api else { return }
        do { _ = try await api.markConversationRead(conversationId: conversationId) }
        catch { /* best-effort */ }
    }

    // Open the Ably channel for this conversation. The handler dedupes by
    // message id so the REST round-trip's optimistic append doesn't double
    // when the publish webhook arrives first.
    func attachRealtime() {
        realtimeSubscription?.cancel()
        realtimeSubscription = RealtimeService.shared.subscribe(
            conversationId: conversationId,
            onMessage: { [weak self] msg in
                guard let self else { return }
                if self.messages.contains(where: { $0.id == msg.id }) { return }
                self.messages.append(msg)
            },
            onTyping: { [weak self] event in
                guard let self else { return }
                // Drop our own echoed typing events so the indicator
                // only shows for the peer.
                if event.userId == self.api?.cachedUserId { return }
                self.peerTypingAt = Date(timeIntervalSince1970: event.timestamp)
            },
            onRead: { [weak self] event in
                guard let self else { return }
                if event.readerUserId == self.api?.cachedUserId { return }
                self.peerReadAt = event.readAt
                // Patch any in-memory rows so the per-message readAt is
                // present too (used by older audit code paths).
                self.messages = self.messages.map { msg in
                    if msg.senderUserId == self.api?.cachedUserId && msg.readAt == nil {
                        return MessageDTO(
                            id: msg.id,
                            conversationId: msg.conversationId,
                            senderUserId: msg.senderUserId,
                            body: msg.body,
                            createdAt: msg.createdAt,
                            deliveredAt: msg.deliveredAt ?? event.readAt,
                            readAt: event.readAt,
                            audioPath: msg.audioPath,
                            audioDurationMs: msg.audioDurationMs,
                            reactions: msg.reactions
                        )
                    }
                    return msg
                }
            },
            onReaction: { [weak self] event in
                guard let self else { return }
                self.messages = self.messages.map { msg in
                    guard msg.id == event.messageId else { return msg }
                    var reactions = msg.reactions
                    if event.removed {
                        reactions.removeAll {
                            $0.userId == event.userId && $0.emoji == event.emoji
                        }
                    } else if !reactions.contains(where: {
                        $0.userId == event.userId && $0.emoji == event.emoji
                    }) {
                        reactions.append(MessageReactionDTO(
                            userId: event.userId,
                            emoji: event.emoji,
                            createdAt: Date()
                        ))
                    }
                    return MessageDTO(
                        id: msg.id,
                        conversationId: msg.conversationId,
                        senderUserId: msg.senderUserId,
                        body: msg.body,
                        createdAt: msg.createdAt,
                        deliveredAt: msg.deliveredAt,
                        readAt: msg.readAt,
                        audioPath: msg.audioPath,
                        audioDurationMs: msg.audioDurationMs,
                        reactions: reactions
                    )
                }
            }
        )
    }

    func detachRealtime() {
        realtimeSubscription?.cancel()
        realtimeSubscription = nil
    }

    // Called from the text field's onChange. Debounces typing publishes
    // to one every 300ms while the user is actively typing.
    func handleDraftChanged() {
        guard let api else { return }
        typingDebounceTask?.cancel()
        typingDebounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard let self else { return }
            guard !Task.isCancelled else { return }
            // Don't fire more than once per second from the OUTBOUND
            // side even if the debounce fires repeatedly — the receiver
            // already maintains its own 4-second visibility window.
            let now = Date()
            if now.timeIntervalSince(self.lastTypingPublishedAt) < 1.0 { return }
            self.lastTypingPublishedAt = now
            RealtimeService.shared.publishTyping(
                conversationId: self.conversationId,
                userId: api.cachedUserId ?? "unknown"
            )
        }
    }

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

    func retry(_ id: UUID) {
        queue.retry(id)
        refreshPending()
        Task { [weak self] in
            guard let self, let api = self.api else { return }
            await self.queue.attemptDeliver(api: api)
            self.refreshPending()
        }
    }

    func discard(_ id: UUID) {
        queue.discard(id)
        refreshPending()
    }

    func tick() async {
        guard let api else { return }
        await queue.attemptDeliver(api: api)
        refreshPending()
    }

    func refreshAfterForeground() async {
        await load()
        await tick()
    }

    var rows: [ConversationRow] {
        let server = messages.map { ConversationRow.server($0) }
        let pendingRows = pending.map { ConversationRow.pending($0) }
        return server + pendingRows
    }

    func send() async {
        enqueueDraft()
    }

    // Voice-note upload. Called from ConversationView when the user
    // releases the hold-to-record button. The recorder produced an
    // in-memory blob; we ship it straight to the backend (no offline
    // queue support yet — voice notes require a live connection).
    func sendVoiceNote(data: Data, durationMs: Int) async {
        guard let api else { return }
        do {
            let msg = try await api.sendVoiceNote(
                conversationId: conversationId,
                audio: data,
                mimeType: VoiceNoteCoordinator.mimeType,
                durationMs: durationMs
            )
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            self.error = "Couldn't send voice note."
        }
    }

    // Reactions. Long-press on a bubble → pick emoji → this fires.
    // Optimistically apply locally so the badge appears immediately.
    func toggleReaction(messageId: String, emoji: String) async {
        guard let api, let myId = api.cachedUserId else { return }
        let existing = messages.first { $0.id == messageId }?
            .reactions
            .contains { $0.userId == myId && $0.emoji == emoji } ?? false
        // Optimistic mutation
        messages = messages.map { msg in
            guard msg.id == messageId else { return msg }
            var rs = msg.reactions
            if existing {
                rs.removeAll { $0.userId == myId && $0.emoji == emoji }
            } else {
                rs.append(MessageReactionDTO(userId: myId, emoji: emoji, createdAt: Date()))
            }
            return MessageDTO(
                id: msg.id,
                conversationId: msg.conversationId,
                senderUserId: msg.senderUserId,
                body: msg.body,
                createdAt: msg.createdAt,
                deliveredAt: msg.deliveredAt,
                readAt: msg.readAt,
                audioPath: msg.audioPath,
                audioDurationMs: msg.audioDurationMs,
                reactions: rs
            )
        }
        do {
            if existing {
                try await api.removeReaction(messageId: messageId, emoji: emoji)
            } else {
                try await api.addReaction(messageId: messageId, emoji: emoji)
            }
        } catch {
            // Roll back on failure — re-fetch is the simplest recovery.
            await load()
        }
    }

    // Helper: the latest readAt seen on any message I sent. Drives the
    // single "Delivered" / "Read at HH:mm" label rendered under my
    // most recent message.
    private func latestPeerReadAt(in messages: [MessageDTO]) -> Date? {
        let myId = api?.cachedUserId
        return messages
            .filter { $0.senderUserId == myId && $0.readAt != nil }
            .compactMap(\.readAt)
            .max()
    }

    // ID of the latest message FROM the current user. The receipt label
    // is only rendered under this row.
    var latestOwnMessageId: String? {
        let myId = api?.cachedUserId
        return messages.last { $0.senderUserId == myId }?.id
    }

    var ownLatestReceiptLabel: String? {
        let myId = api?.cachedUserId
        guard let last = messages.last(where: { $0.senderUserId == myId }) else {
            return nil
        }
        if let readAt = last.readAt ?? peerReadAt {
            let f = DateFormatter()
            f.dateFormat = "HH:mm"
            return "Read at \(f.string(from: readAt))"
        }
        if last.deliveredAt != nil {
            return "Delivered"
        }
        return nil
    }
}

struct ConversationView: View {
    @EnvironmentObject private var api: APIClient
    let conversationId: String
    let title: String
    @StateObject private var vm: ConversationViewModel
    @StateObject private var voicePlayer = VoiceNotePlayer.shared
    @State private var pollTask: Task<Void, Never>?
    // Drives a 1s heartbeat so the typing indicator hides 4 seconds
    // after the last received typing event without explicit state
    // bookkeeping.
    @State private var nowTick: Date = Date()
    @State private var recorder = VoiceNoteCoordinator()
    @State private var isRecording: Bool = false
    @State private var reactionPickerForMessageId: String?

    private static let typingWindow: TimeInterval = 4
    private let reactionEmojis = ["❤️", "👍", "😂", "😮", "😢", "🔥"]

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
                            if isPeerTyping {
                                typingBubble
                                    .id("typing-indicator")
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

                // DISC-Q2 — suggested-opener pills. Only present when
                // the conversation is empty and the user hasn't begun
                // typing. Tapping a pill drops its text into the draft
                // field without auto-sending so the user can edit.
                if vm.shouldShowSuggestedOpeners {
                    SuggestedOpenersStrip(
                        openers: vm.suggestedOpeners,
                        onTap: { vm.applySuggestedOpener($0) }
                    )
                    .padding(.horizontal, OMSpacing.md)
                    .padding(.top, OMSpacing.sm)
                    .padding(.bottom, OMSpacing.xs)
                    .transition(.opacity)
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
                        .onChange(of: vm.draft) { _, _ in
                            vm.handleDraftChanged()
                        }
                    if vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        recordButton
                    } else {
                        sendButton
                    }
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
            await vm.markRead()
            await vm.tick()
            // DISC-Q2 — request suggested openers only when the chat
            // is genuinely empty. The view-model is the gatekeeper so
            // we don't hammer the endpoint on every screen entry.
            await vm.loadSuggestedOpenersIfNeeded()
            startPolling()
        }
        .onDisappear {
            vm.detachRealtime()
            pollTask?.cancel()
            pollTask = nil
            recorder.cancelRecording()
        }
        .onReceive(NotificationCenter.default.publisher(for: .openMatchDidForeground)) { _ in
            Task { await vm.refreshAfterForeground() }
        }
        // 1s heartbeat for the typing-indicator visibility window. Cheap
        // — only re-renders the row when the indicator's visibility
        // actually changes thanks to SwiftUI's diffing.
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { now in
            self.nowTick = now
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

    private var isPeerTyping: Bool {
        guard let ts = vm.peerTypingAt else { return false }
        return nowTick.timeIntervalSince(ts) < Self.typingWindow
    }

    private var sendButton: some View {
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

    // Hold-to-record. We use a DragGesture instead of LongPressGesture
    // because the latter doesn't expose a per-finger lifecycle (start,
    // continued hold, release with cancel-on-drag-off). A 0-distance
    // DragGesture fires `onChanged` on touch-down and `onEnded` on lift.
    private var recordButton: some View {
        Image(systemName: isRecording ? "stop.circle.fill" : "mic.fill")
            .font(.system(size: 16, weight: .semibold))
            .padding(10)
            .background(
                isRecording ? OMColor.magenta : OMColor.plum,
                in: Circle()
            )
            .foregroundStyle(OMColor.onAccent)
            .accessibilityLabel(isRecording ? "Stop recording" : "Hold to record voice note")
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        if !isRecording {
                            do {
                                try recorder.startRecording()
                                isRecording = true
                            } catch {
                                vm.error = "Microphone unavailable."
                            }
                        }
                    }
                    .onEnded { _ in
                        if isRecording {
                            isRecording = false
                            if let (data, durationMs) = recorder.stopRecording() {
                                Task { await vm.sendVoiceNote(data: data, durationMs: durationMs) }
                            }
                        }
                    }
            )
    }

    private var typingBubble: some View {
        HStack {
            HStack(spacing: 4) {
                Circle().fill(OMColor.ink.opacity(0.5)).frame(width: 6, height: 6)
                Circle().fill(OMColor.ink.opacity(0.5)).frame(width: 6, height: 6)
                Circle().fill(OMColor.ink.opacity(0.5)).frame(width: 6, height: 6)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(OMColor.surfaceElevated, in: OMShape.card(OMRadius.md))
            .overlay(OMShape.card(OMRadius.md).stroke(OMColor.cardStroke, lineWidth: 1))
            .accessibilityLabel("Typing")
            Spacer(minLength: 40)
        }
    }

    @ViewBuilder
    private func rowView(_ row: ConversationRow) -> some View {
        switch row {
        case .server(let m):
            let isMine = m.senderUserId == api.cachedUserId
            VStack(alignment: isMine ? .trailing : .leading, spacing: 2) {
                MessageBubble(
                    isMine: isMine,
                    message: m,
                    state: .sent,
                    playerProgress: voicePlayer.playingMessageId == m.id ? voicePlayer.progress : nil,
                    onPlayAudio: {
                        Task { await voicePlayer.play(messageId: m.id, api: api) }
                    }
                )
                .onLongPressGesture {
                    reactionPickerForMessageId = m.id
                }
                if !m.reactions.isEmpty {
                    reactionsRow(for: m)
                        .padding(isMine ? .trailing : .leading, 8)
                }
                if isMine && m.id == vm.latestOwnMessageId,
                   let label = vm.ownLatestReceiptLabel {
                    Text(label)
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.ink.opacity(0.55))
                        .padding(.trailing, 8)
                        .padding(.top, 2)
                }
            }
            .confirmationDialog(
                "React",
                isPresented: .init(
                    get: { reactionPickerForMessageId == m.id },
                    set: { if !$0 { reactionPickerForMessageId = nil } }
                )
            ) {
                ForEach(reactionEmojis, id: \.self) { emoji in
                    Button(emoji) {
                        Task { await vm.toggleReaction(messageId: m.id, emoji: emoji) }
                        reactionPickerForMessageId = nil
                    }
                }
                Button("Cancel", role: .cancel) {
                    reactionPickerForMessageId = nil
                }
            }
        case .pending(let p):
            MessageBubble(
                isMine: true,
                message: MessageDTO(
                    id: p.id.uuidString,
                    conversationId: conversationId,
                    senderUserId: api.cachedUserId ?? "",
                    body: p.body,
                    createdAt: Date()
                ),
                state: p.lastError == nil ? .sending : .failed,
                playerProgress: nil,
                onPlayAudio: nil
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

    // Bucket reactions by emoji so the badge row reads "🔥 2  ❤️ 1"
    // instead of one badge per reactor.
    private func reactionsRow(for m: MessageDTO) -> some View {
        let groups = Dictionary(grouping: m.reactions, by: { $0.emoji })
        return HStack(spacing: 6) {
            ForEach(groups.keys.sorted(), id: \.self) { emoji in
                let count = groups[emoji]?.count ?? 0
                Text(count > 1 ? "\(emoji) \(count)" : emoji)
                    .font(OMFont.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(OMColor.surfaceSunken, in: Capsule())
                    .onTapGesture {
                        Task { await vm.toggleReaction(messageId: m.id, emoji: emoji) }
                    }
            }
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

// DISC-Q2 — suggested-opener pill strip. Renders above the input bar
// when a fresh conversation has no messages yet. Horizontally
// scrollable when the openers don't fit on screen. Accessible: each
// pill is its own button labelled with the opener text.
struct SuggestedOpenersStrip: View {
    let openers: [SuggestedOpenerDTO]
    let onTap: (SuggestedOpenerDTO) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Need a starter?")
                .font(OMFont.caption)
                .foregroundStyle(OMColor.inkSubtle)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(openers) { opener in
                        Button {
                            Haptics.threshold()
                            onTap(opener)
                        } label: {
                            Text(opener.text)
                                .font(OMFont.callout)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(
                                    OMShape.chip().fill(OMColor.surfaceSunken)
                                )
                                .overlay(
                                    OMShape.chip().stroke(OMColor.cardStroke, lineWidth: 1)
                                )
                                .foregroundStyle(OMColor.ink)
                                .frame(maxWidth: 260, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Use opener: \(opener.text)"))
                        .accessibilityHint(Text("Inserts the suggested opener into the message field"))
                    }
                }
            }
        }
    }
}

private struct MessageBubble: View {
    enum State { case sent, sending, failed }
    let isMine: Bool
    let message: MessageDTO
    let state: State
    // 0...1 when currently playing this bubble's audio, nil otherwise.
    let playerProgress: Double?
    let onPlayAudio: (() -> Void)?

    var body: some View {
        HStack {
            if isMine { Spacer(minLength: 40) }
            HStack(spacing: 6) {
                if let path = message.audioPath, !path.isEmpty {
                    audioContent
                } else {
                    Text(message.body)
                        .font(OMFont.bodyRegular)
                }
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

    private var audioContent: some View {
        let durationMs = message.audioDurationMs ?? 0
        let totalSec = Double(durationMs) / 1000.0
        let isPlaying = playerProgress != nil
        let elapsed = (playerProgress ?? 0) * totalSec
        return HStack(spacing: 8) {
            Button {
                onPlayAudio?()
            } label: {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 22))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isPlaying ? "Pause voice note" : "Play voice note")
            // Simple block-waveform fill. Animated progress driven by
            // VoiceNotePlayer.progress.
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill((isMine ? OMColor.onAccent : OMColor.ink).opacity(0.25))
                        .frame(height: 4)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(isMine ? OMColor.onAccent : OMColor.ink)
                        .frame(width: geo.size.width * (playerProgress ?? 0), height: 4)
                }
                .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(width: 100, height: 16)
            Text(formatDuration(isPlaying ? elapsed : totalSec))
                .font(OMFont.caption)
                .monospacedDigit()
        }
    }

    private func formatDuration(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private var bubbleBackground: Color {
        if !isMine { return OMColor.surfaceElevated }
        switch state {
        case .sent, .sending: return OMColor.plum
        case .failed: return OMColor.magenta.opacity(0.85)
        }
    }
}
