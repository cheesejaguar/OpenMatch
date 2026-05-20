import UIKit
import UserNotifications

// Thin wrapper that asks for notification authorization and, if
// granted, kicks off remote-notification registration with APNs. The
// callsite is responsible for choosing the *moment* to ask (e.g. after
// the user's first match). We never auto-prompt at launch — that's a
// known anti-pattern that produces high opt-out rates.
@MainActor
final class PushService {
    static let shared = PushService()
    private init() {}

    private(set) var didAttemptThisSession = false

    // Returns true if the user granted notifications. Idempotent in
    // practice — iOS only shows the system prompt once per install.
    func requestAuthorization() async -> Bool {
        didAttemptThisSession = true
        #if DEBUG
        // UX-review hook: suppress the system notifications prompt so
        // screenshot captures don't get blocked by a permission dialog.
        // Set SIMCTL_CHILD_OPENMATCH_SUPPRESS_PUSH_PROMPT=1 when launching.
        if ProcessInfo.processInfo.environment["OPENMATCH_SUPPRESS_PUSH_PROMPT"] == "1" {
            return false
        }
        #endif
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
            return granted
        } catch {
            print("[Push] authorization request failed: \(error)")
            return false
        }
    }
}
