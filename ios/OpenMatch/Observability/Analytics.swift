import Foundation

// Lightweight, fire-and-forget analytics wrapper.
//
// Design notes
// ------------
//  - Events buffer in memory and flush either every `flushIntervalSeconds`
//    or when the buffer reaches `maxBatch`, whichever comes first.
//  - Failures are dropped silently. Analytics is best-effort; we never
//    want a backend hiccup to slow the UI or retry-storm.
//  - The actor is global (`Analytics.shared`) so any call site can
//    `await Analytics.shared.record(...)` without plumbing state.
//  - The `api` reference is `weak` so the actor doesn't extend
//    APIClient's lifetime — the AppState owns the client.
actor Analytics {
    static let shared = Analytics()

    private var buffer: [AnalyticsEvent] = []
    private let maxBatch = 20
    private let flushIntervalSeconds: TimeInterval = 5
    private weak var api: APIClient?
    private var flushTask: Task<Void, Never>?

    func attach(api: APIClient) {
        self.api = api
        if flushTask == nil {
            flushTask = Task { [weak self] in
                while !Task.isCancelled {
                    let ns = UInt64((self?.flushIntervalSeconds ?? 5) * 1_000_000_000)
                    try? await Task.sleep(nanoseconds: ns)
                    await self?.flush()
                }
            }
        }
    }

    func record(_ name: String, _ properties: [String: AnalyticsValue] = [:]) {
        let event = AnalyticsEvent(name: name, properties: properties, clientTs: Date())
        buffer.append(event)
        if buffer.count >= maxBatch {
            Task { await self.flush() }
        }
    }

    // Exposed for tests — flush synchronously and return event count
    // that would have been sent.
    @discardableResult
    func flush() async -> Int {
        guard !buffer.isEmpty else { return 0 }
        guard let api else { return buffer.count }
        let batch = buffer
        buffer.removeAll(keepingCapacity: true)
        do {
            try await api.recordAnalytics(events: batch)
        } catch {
            // Best-effort. Drop the batch — we never want to retry
            // ourselves into a request storm during a backend outage.
        }
        return batch.count
    }

    // Test-only inspection helpers.
    func currentBufferCount() -> Int { buffer.count }
}

struct AnalyticsEvent: Codable, Equatable {
    let name: String
    let properties: [String: AnalyticsValue]
    let clientTs: Date
}

// A small sum type that encodes / decodes as a raw JSON primitive so
// the backend can store events as `Json` without an extra envelope.
//
// We intentionally don't support nested objects or arrays — flat
// properties keep both the schema and the analytic queries simple.
enum AnalyticsValue: Codable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        // Order matters: bool decodes from `true`/`false`; Int decodes
        // before Double so whole numbers don't round-trip as floats.
        if let v = try? c.decode(Bool.self) {
            self = .bool(v)
            return
        }
        if let v = try? c.decode(Int.self) {
            self = .int(v)
            return
        }
        if let v = try? c.decode(Double.self) {
            self = .double(v)
            return
        }
        if let v = try? c.decode(String.self) {
            self = .string(v)
            return
        }
        throw DecodingError.dataCorruptedError(
            in: c,
            debugDescription: "AnalyticsValue: expected string/int/double/bool"
        )
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        }
    }
}

// Convenience builders so call sites read naturally:
//   Analytics.shared.record("foo", ["x": .s("bar"), "n": .i(3)])
extension AnalyticsValue {
    static func s(_ v: String) -> AnalyticsValue { .string(v) }
    static func i(_ v: Int) -> AnalyticsValue { .int(v) }
    static func d(_ v: Double) -> AnalyticsValue { .double(v) }
    static func b(_ v: Bool) -> AnalyticsValue { .bool(v) }
}
