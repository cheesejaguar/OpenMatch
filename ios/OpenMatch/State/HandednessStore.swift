import Combine
import Foundation
import SwiftUI

/// Persists the user's thumb-reach preference for the swipe deck action
/// row (X / heart anchor: right / left / center).
///
/// Storage strategy:
///   - UserDefaults at key `openmatch.handedness` is the local cache so
///     the UI can render in the user's preferred layout instantly on
///     cold launch, before any network round-trip.
///   - The backend (`/api/v1/preferences/me.handedness`) is the source
///     of truth. On login / app foreground we GET preferences and the
///     server value overwrites the local cache.
///   - Mutations are written-through: UserDefaults updates immediately
///     and a debounced PATCH is fired so rapid changes (e.g. cycling
///     through the picker) coalesce to a single network call.
@MainActor
final class HandednessStore: ObservableObject {
    static let userDefaultsKey = "openmatch.handedness"
    private static let debounceInterval: TimeInterval = 0.5

    @Published var current: Handedness {
        didSet {
            guard oldValue != current else { return }
            defaults.set(current.rawValue, forKey: Self.userDefaultsKey)
            schedulePatch()
        }
    }

    private let defaults: UserDefaults
    private let api: APIClient?
    private var patchTask: Task<Void, Never>?

    init(api: APIClient? = nil, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
        if let raw = defaults.string(forKey: Self.userDefaultsKey),
           let cached = Handedness(rawValue: raw) {
            self.current = cached
        } else {
            self.current = .right
        }
    }

    /// Pulls the server-side preference and overwrites the local cache.
    /// Server wins on conflict — the user's choice on another device
    /// supersedes whatever a stale install has cached locally.
    func refreshFromServer() async {
        guard let api else { return }
        do {
            let prefs = try await api.preferences()
            if let raw = prefs.handedness, let next = Handedness(rawValue: raw) {
                if next != current {
                    // Bypass the didSet PATCH — the value already
                    // matches the server.
                    defaults.set(next.rawValue, forKey: Self.userDefaultsKey)
                    current = next
                    patchTask?.cancel()
                }
            }
        } catch {
            // Best-effort refresh; the local cache is good enough.
        }
    }

    private func schedulePatch() {
        guard let api else { return }
        patchTask?.cancel()
        let next = current
        patchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.debounceInterval * 1_000_000_000))
            guard !Task.isCancelled else { return }
            _ = try? await api.updateHandedness(next)
            _ = self // retain
        }
    }
}
