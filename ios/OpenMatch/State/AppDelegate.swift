import UIKit
import UserNotifications

// Bridges UIKit's UIApplicationDelegate lifecycle into our SwiftUI app.
// iOS 17+ uses `UIApplicationDelegateAdaptor` to inject the delegate
// while we still own the App entrypoint. The delegate handles APNs
// device-token registration; the actual permission prompt is fired
// from `PushService` at the right moment in the user journey (after
// the first match, not at launch).
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    static let shared = AppDelegate()

    // Set by `AppState.init` so it can forward the device token to the
    // backend once we have both a session and a token. Stored as a
    // closure (not a strong reference to AppState) to avoid a cycle.
    var onDeviceToken: ((String) -> Void)?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationCenterDelegate.shared
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // APNs gives us raw bytes; convert to the lowercase hex string
        // the server expects.
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        onDeviceToken?(hex)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Soft-failure: in dev / simulator builds APNs registration
        // routinely fails. Log and move on — the rest of the app
        // remains usable.
        print("[APNs] registration failed: \(error)")
    }
}

// Foreground-presentation policy. Without this, an APNs push that
// arrives while the app is foregrounded is delivered silently. We want
// the banner + sound + badge so the user notices a new match/message.
@MainActor
final class NotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCenterDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }
}
