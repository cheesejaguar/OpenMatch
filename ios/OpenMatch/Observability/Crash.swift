import Foundation

#if canImport(Sentry)
import Sentry
#endif

// Crash reporting wrapper. The actual SDK is conditionally compiled: if
// the Sentry SwiftPM dependency resolves at build time, we initialise
// it; otherwise the methods are no-ops that preserve the call sites.
//
// Why this shape:
//  - The DSN is read from Info.plist (`SentryDSN`). Empty / missing DSN
//    is a no-op so CI builds and local-dev builds without a configured
//    project don't crash on startup.
//  - The operator pastes the production DSN before the TestFlight cut.
//    See PR description and `docs/launch/REPORT_CARD.md` IOS-2.
//
// All `SentrySDK.*` call sites — here and in the rest of the iOS target
// (see `omRunWithHTTPSpan` in `Networking/APIClient.swift`) — must gate
// on `Crash.isReporting`. If we call into the SDK before `bootstrap()`
// has successfully started it, the SDK lazily spins up a default hub on
// whatever queue the caller happens to be on. That hub init reads
// `UIApplication.applicationState`, which Main Thread Checker rejects
// off the main thread, and the test process aborts with signal abrt
// before any test case runs. The empty-DSN path in the test target is
// the canonical reproducer.
//
// TODO(IOS-2): If the SwiftPM resolution of getsentry/sentry-cocoa
// fails in CI (xcodegen / Xcode mismatch), strip `Sentry` from the
// `packages:` block in `ios/project.yml`. The `#if canImport(Sentry)`
// guard below makes the rest of the file inert when the import is
// unavailable. The integration ships; the SDK can be reattached
// without a feature flag.
enum Crash {
    /// `true` iff `bootstrap()` actually called `SentrySDK.start { ... }`
    /// and the SDK reports itself as enabled. Call sites use this to
    /// avoid touching `SentrySDK.*` APIs that would otherwise lazily
    /// construct a default hub off the main thread.
    static var isReporting: Bool {
        #if canImport(Sentry)
        return sentryStarted && SentrySDK.isEnabled
        #else
        return false
        #endif
    }

    #if canImport(Sentry)
    /// Belt-and-braces flag flipped to `true` after `SentrySDK.start { ... }`
    /// returns. Used in `isReporting` so we never query `SentrySDK.isEnabled`
    /// (which itself can touch the default hub) before we've actually
    /// started the SDK.
    private static var sentryStarted: Bool = false
    #endif

    static func bootstrap() {
        #if canImport(Sentry)
        guard let dsn = Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String,
              !dsn.isEmpty else {
            return
        }
        SentrySDK.start { options in
            options.dsn = dsn
            if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String {
                options.releaseName = "openmatch-ios@\(version)"
            }
            let env = (Bundle.main.infoDictionary?["SentryEnvironment"] as? String) ?? "development"
            options.environment = env
            options.tracesSampleRate = 0.1
            options.attachStacktrace = true
        }
        sentryStarted = true
        #endif
    }

    static func setUser(id: String?) {
        #if canImport(Sentry)
        guard isReporting else { return }
        if let id {
            let u = User()
            u.userId = id
            SentrySDK.setUser(u)
        } else {
            SentrySDK.setUser(nil)
        }
        #else
        _ = id  // unused without Sentry
        #endif
    }

    static func capture(_ error: Error) {
        #if canImport(Sentry)
        guard isReporting else {
            print("[Crash] (Sentry not started) \(error)")
            return
        }
        SentrySDK.capture(error: error)
        #else
        print("[Crash] (no Sentry) \(error)")
        #endif
    }
}
