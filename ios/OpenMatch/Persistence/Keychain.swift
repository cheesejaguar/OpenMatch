import Foundation
import Security

// SEV-M1 hardening — every keychain item is written with:
//   * kSecAttrAccessible = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
//     (token cannot leave the device via encrypted backup / device
//     transfer, and is only readable while the device is unlocked)
//   * kSecAttrSynchronizable = false (explicitly opt out of iCloud
//     Keychain sync; without this the platform default may sync depending
//     on app entitlements)
//
// On read we look up by service + account only (omitting kSecAttrSynchronizable
// returns *both* device-local and synced items per Apple's docs), then
// auto-migrate any legacy item that was stored under the default access
// class to the hardened attributes. This is a one-shot rewrite that keeps
// existing logged-in users signed in across upgrade.
//
// Query construction lives in `Self.addQuery` / `Self.readQuery` /
// `Self.deleteQuery` so KeychainTests can assert the hardened attributes
// directly without needing a writable simulator keychain (the test
// bundle, even when hosted in OpenMatch.app, runs without
// `keychain-access-groups` under CODE_SIGNING_ALLOWED=NO and
// SecItemAdd returns errSecMissingEntitlement (-34018) on simulator).
final class Keychain {
    static let shared = Keychain()
    private init() {}

    enum Key: String {
        case accessToken
        case refreshToken
        case userId
    }

    private let service = "app.openmatch.ios"

    // Hardened accessibility class — token is only usable when device is
    // unlocked, and never leaves this device (no iCloud Keychain sync,
    // no encrypted-backup restore to another device).
    static let accessibility: CFString = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

    func write(_ key: Key, _ value: String) {
        SecItemDelete(Self.matchAnySyncableQuery(service: service, key: key) as CFDictionary)
        let status = SecItemAdd(Self.addQuery(service: service, key: key, value: value) as CFDictionary, nil)
        #if DEBUG
        if status != errSecSuccess {
            print("[Keychain] SecItemAdd(\(key.rawValue)) failed: OSStatus \(status)")
        }
        #endif
    }

    func read(_ key: Key) -> String? {
        var item: AnyObject?
        let status = SecItemCopyMatching(Self.readQuery(service: service, key: key) as CFDictionary, &item)
        guard status == errSecSuccess,
              let dict = item as? [CFString: Any],
              let data = dict[kSecValueData] as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }

        // One-shot migration: if the stored item is either iCloud-synced
        // or uses an accessibility class weaker than our target, rewrite
        // it under the hardened attributes. This keeps logged-in users
        // signed in across the upgrade.
        let storedAccessibility = dict[kSecAttrAccessible] as? String
        let isSynced = (dict[kSecAttrSynchronizable] as? Bool) ?? false
        let targetAccessibility = Self.accessibility as String
        if isSynced || storedAccessibility != targetAccessibility {
            write(key, value)
        }
        return value
    }

    func delete(_ key: Key) {
        SecItemDelete(Self.matchAnySyncableQuery(service: service, key: key) as CFDictionary)
    }

    // MARK: - Query construction (testable)

    // The full attribute dict passed to SecItemAdd. KeychainTests asserts
    // the hardened attrs on this directly so the assertion holds without
    // needing a writable simulator keychain.
    static func addQuery(service: String, key: Key, value: String) -> [CFString: Any] {
        var q = baseQuery(service: service, key: key)
        q[kSecAttrSynchronizable] = kCFBooleanFalse
        q[kSecAttrAccessible] = accessibility
        q[kSecValueData] = Data(value.utf8)
        return q
    }

    // The dict passed to SecItemCopyMatching. Returns the full attributes
    // (kSecReturnAttributes = true) so `read` can spot legacy items that
    // need migration.
    static func readQuery(service: String, key: Key) -> [CFString: Any] {
        var q = baseQuery(service: service, key: key)
        // Match both device-local and any pre-existing synced item so the
        // migration branch in `read` can detect a legacy entry and rewrite
        // it under the hardened attrs.
        q[kSecAttrSynchronizable] = kSecAttrSynchronizableAny
        q[kSecReturnData] = true
        q[kSecReturnAttributes] = true
        q[kSecMatchLimit] = kSecMatchLimitOne
        return q
    }

    // The dict passed to SecItemDelete when deleting (or as a wildcard
    // matcher before an Add to clear any prior local-or-synced entry).
    static func matchAnySyncableQuery(service: String, key: Key) -> [CFString: Any] {
        var q = baseQuery(service: service, key: key)
        q[kSecAttrSynchronizable] = kSecAttrSynchronizableAny
        return q
    }

    private static func baseQuery(service: String, key: Key) -> [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key.rawValue
        ]
    }
}
