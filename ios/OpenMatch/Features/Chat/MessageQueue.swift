import Foundation
import Combine

// Optimistic message-send queue with bounded retry. Messages are enqueued
// the moment the user taps send and persisted to disk so a force-quit
// (or OOM during background) doesn't lose the draft. Delivery is driven
// by `attemptDeliver(api:)`, which is invoked:
//   - every 10s while a ConversationView is foregrounded
//   - on scenePhase .active (via Notification.Name.openMatchDidForeground)
//   - on an explicit user "Tap to retry"
//
// Backoff schedule (seconds, indexed by `attempts`):
//   attempt 0 → 0     (immediate)
//   attempt 1 → 2
//   attempt 2 → 8
//   attempt 3 → 30
//   attempt 4 → drop (deliveryFailed)
//
// On success the optimistic row is replaced in-place with the server's
// MessageDTO via the `onDelivered` callback that ConversationView
// installs when it subscribes.
@MainActor
final class MessageQueue: ObservableObject {
    @Published private(set) var pending: [PendingMessage] = []

    static let shared = MessageQueue(storage: .userDocuments)

    // Called when the server accepts an optimistic message. The closure
    // receives the optimistic id and the canonical DTO so the view can
    // swap the row without reordering.
    var onDelivered: ((UUID, MessageDTO) -> Void)?
    // Called when a message has failed `maxAttempts` times and is being
    // dropped. The view shows an "undeliverable" affordance.
    var onPermanentFailure: ((PendingMessage) -> Void)?

    private let storage: Storage
    private let clock: Clock
    private let maxAttempts: Int

    // Backoff in seconds keyed by current `attempts` count (the count
    // BEFORE the next try). Index out-of-range → drop.
    private let backoffSchedule: [TimeInterval] = [0, 2, 8, 30]

    init(
        storage: Storage,
        clock: Clock = SystemClock(),
        maxAttempts: Int = 4
    ) {
        self.storage = storage
        self.clock = clock
        self.maxAttempts = maxAttempts
        self.pending = storage.load()
    }

    // MARK: - Public API

    @discardableResult
    func enqueue(conversationId: String, body: String) -> PendingMessage {
        let item = PendingMessage(
            id: UUID(),
            conversationId: conversationId,
            body: body,
            attempts: 0,
            lastError: nil,
            sentAt: nil,
            nextAttemptAt: clock.now()
        )
        pending.append(item)
        persist()
        return item
    }

    // Reset a row's backoff so the next attemptDeliver() pass retries it.
    func retry(_ id: UUID) {
        guard let idx = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[idx].lastError = nil
        pending[idx].nextAttemptAt = clock.now()
        persist()
    }

    // Discard a specific row (user-initiated, e.g. swipe-to-delete). Used
    // by the "undeliverable" affordance and by tests.
    func discard(_ id: UUID) {
        pending.removeAll { $0.id == id }
        persist()
    }

    // Attempt to send every pending message whose backoff window has
    // elapsed. Safe to call concurrently — internal serialization is via
    // @MainActor isolation. The caller passes APIClient (which conforms
    // to MessageSending) in production; tests pass a stub.
    func attemptDeliver(api: MessageSending) async {
        let now = clock.now()
        // Snapshot the work list so mutations during awaits don't
        // re-shuffle the iteration.
        let due = pending.filter { $0.sentAt == nil && $0.nextAttemptAt <= now }
        for item in due {
            await deliver(item: item, sender: api)
        }
    }

    // MARK: - Internal

    private func deliver(item: PendingMessage, sender: MessageSending) async {
        do {
            let dto = try await sender.sendMessage(
                conversationId: item.conversationId,
                body: item.body
            )
            // Mark the slot as delivered locally — we keep it for a moment
            // so the UI can render a checkmark, then drop it on the next
            // poll cycle.
            if let idx = pending.firstIndex(where: { $0.id == item.id }) {
                pending[idx].sentAt = clock.now()
                pending[idx].lastError = nil
            }
            onDelivered?(item.id, dto)
            // Remove from the queue and persist. The view has already
            // appended the canonical DTO via onDelivered.
            pending.removeAll { $0.id == item.id }
            persist()
        } catch {
            await handleFailure(item: item, error: error)
        }
    }

    private func handleFailure(item: PendingMessage, error: Error) async {
        guard let idx = pending.firstIndex(where: { $0.id == item.id }) else { return }
        pending[idx].attempts += 1
        pending[idx].lastError = error.localizedDescription
        let nextAttempts = pending[idx].attempts
        if nextAttempts >= maxAttempts {
            // Drop and notify. The view replaces the spinner with an
            // error indicator and a "Tap to retry" affordance (which
            // calls retry() — bumping `attempts` back into range is the
            // caller's responsibility via the API).
            let dropped = pending[idx]
            pending.remove(at: idx)
            onPermanentFailure?(dropped)
        } else {
            let delay = backoffSchedule[nextAttempts]
            pending[idx].nextAttemptAt = clock.now().addingTimeInterval(delay)
        }
        persist()
    }

    private func persist() {
        storage.save(pending)
    }
}

// Production message-send seam. APIClient conforms to this in
// APIClient+MessageSending.swift; tests substitute a stub.
@MainActor
protocol MessageSending: AnyObject {
    func sendMessage(conversationId: String, body: String) async throws -> MessageDTO
}

// MARK: - Storage / clock seams (top-level so they're nonisolated and
// callable from anywhere the queue lives)

protocol MessageQueueStorage: AnyObject {
    func load() -> [PendingMessage]
    func save(_ items: [PendingMessage])
}

protocol MessageQueueClock {
    func now() -> Date
}

struct SystemMessageQueueClock: MessageQueueClock {
    func now() -> Date { Date() }
}

extension MessageQueue {
    typealias Storage = MessageQueueStorage
    typealias Clock = MessageQueueClock
    typealias SystemClock = SystemMessageQueueClock
}

// PendingMessage is the on-disk + in-memory representation of a queued
// outbound message. `sentAt` is set transiently between server-accept
// and removal from the queue.
struct PendingMessage: Identifiable, Codable, Equatable {
    let id: UUID
    let conversationId: String
    let body: String
    var attempts: Int
    var lastError: String?
    var sentAt: Date?
    // When the next delivery attempt is allowed. Compared against the
    // queue's clock in `attemptDeliver`.
    var nextAttemptAt: Date

    init(
        id: UUID,
        conversationId: String,
        body: String,
        attempts: Int,
        lastError: String?,
        sentAt: Date?,
        nextAttemptAt: Date
    ) {
        self.id = id
        self.conversationId = conversationId
        self.body = body
        self.attempts = attempts
        self.lastError = lastError
        self.sentAt = sentAt
        self.nextAttemptAt = nextAttemptAt
    }
}

// MARK: - Disk-backed storage

extension MessageQueueStorage where Self == FileMessageQueueStorage {
    // Default storage path: Application Support / OpenMatch / message-queue.json
    static var userDocuments: FileMessageQueueStorage {
        FileMessageQueueStorage(url: FileMessageQueueStorage.defaultURL())
    }
}

final class FileMessageQueueStorage: MessageQueueStorage {
    private let url: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(url: URL) {
        self.url = url
        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        // Best-effort: ensure the containing directory exists. We don't
        // throw here because a missing directory at init time just means
        // load() returns []; save() will create it on first write.
        // SEV-M6 — Apply `.completeFileProtection` to the directory so
        // the queue file inherits it. iOS evaluates the protection class
        // at create-time; setting it on the directory means future
        // writes in this folder get the same class without each caller
        // having to remember.
        let dir = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(
            at: dir,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        // Also exclude the queue directory from iCloud / iTunes backups
        // so the at-rest message bodies can't escape via a backup
        // restore onto a second device. The flag is best-effort — on a
        // brand-new install the directory may not exist yet; the same
        // attribute is re-applied in save() before each write.
        var mutableDir = dir
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? mutableDir.setResourceValues(values)
    }

    static func defaultURL() -> URL {
        let base = (try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("OpenMatch", isDirectory: true)
            .appendingPathComponent("message-queue.json")
    }

    func load() -> [PendingMessage] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? decoder.decode([PendingMessage].self, from: data)) ?? []
    }

    func save(_ items: [PendingMessage]) {
        do {
            let data = try encoder.encode(items)
            // SEV-M6 — `.completeFileProtection` makes the bytes
            // unreadable when the device is locked, which is the
            // strongest data-protection class iOS offers. Combined with
            // `.atomic` (write to tempfile, fsync, rename) we keep
            // crash-consistency *and* at-rest encryption tied to the
            // user's passcode.
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            // Re-apply the no-backup attribute on the file itself so a
            // queue-file that pre-dates the directory-level attribute
            // (e.g. an upgrade install) is also excluded.
            var fileURL = url
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? fileURL.setResourceValues(values)
        } catch {
            // Persistence is best-effort. On failure the queue still
            // works in-memory for the current process lifetime.
        }
    }
}

// MARK: - In-memory storage (tests)

final class InMemoryMessageQueueStorage: MessageQueueStorage {
    var items: [PendingMessage]
    init(_ items: [PendingMessage] = []) { self.items = items }
    func load() -> [PendingMessage] { items }
    func save(_ items: [PendingMessage]) { self.items = items }
}
