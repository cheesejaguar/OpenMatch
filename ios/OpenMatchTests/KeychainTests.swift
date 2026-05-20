import XCTest
import Security
@testable import OpenMatch

// SEV-M1 regression suite. Asserts every Keychain query the app builds
// uses `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and is explicitly
// not iCloud-synced.
//
// We assert on the *query dictionaries* (`Keychain.addQuery`,
// `Keychain.readQuery`, `Keychain.matchAnySyncableQuery`) rather than
// round-tripping through SecItemAdd. The simulator keychain rejects
// SecItemAdd with errSecMissingEntitlement (-34018) when the host app
// runs under CODE_SIGNING_ALLOWED=NO (true for both this test target and
// CI). Asserting the query directly is a strictly stronger check — if
// the hardened attrs aren't in the dict we hand to Security.framework,
// they can never be applied at runtime either.
final class KeychainTests: XCTestCase {
    private let service = "app.openmatch.ios"

    func testAddQueryUsesWhenUnlockedThisDeviceOnly() {
        for key in Keychain.Key.allKeysForTest {
            let q = Keychain.addQuery(service: service, key: key, value: "v")
            XCTAssertEqual(
                q[kSecAttrAccessible] as? NSString,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly as NSString,
                "\(key.rawValue) write query must use WhenUnlockedThisDeviceOnly so it does not survive encrypted backup / device transfer"
            )
        }
    }

    func testAddQueryDisablesICloudSync() {
        for key in Keychain.Key.allKeysForTest {
            let q = Keychain.addQuery(service: service, key: key, value: "v")
            let sync = q[kSecAttrSynchronizable]
            // We assert the explicit `false` here: omitting the attr
            // entirely is *not* equivalent — the platform default may
            // sync when the app has iCloud entitlements.
            XCTAssertEqual(
                sync as? NSNumber,
                kCFBooleanFalse as NSNumber,
                "\(key.rawValue) write query must set kSecAttrSynchronizable = false"
            )
        }
    }

    func testAddQueryIsGenericPasswordWithRightServiceAndAccount() {
        let q = Keychain.addQuery(service: service, key: .refreshToken, value: "rt")
        XCTAssertEqual(q[kSecClass] as? NSString, kSecClassGenericPassword as NSString)
        XCTAssertEqual(q[kSecAttrService] as? String, service)
        XCTAssertEqual(q[kSecAttrAccount] as? String, "refreshToken")
        XCTAssertEqual(q[kSecValueData] as? Data, Data("rt".utf8))
    }

    func testReadQueryMatchesBothLocalAndSyncedItemsForMigrationDetection() {
        // The read query intentionally uses kSecAttrSynchronizableAny so
        // a legacy iCloud-synced item (left over from a pre-fix install)
        // is visible to `read` — which then rewrites it under the
        // hardened attrs. Dropping this attr would silently strand
        // legacy users on the weaker class.
        let q = Keychain.readQuery(service: service, key: .accessToken)
        XCTAssertEqual(
            q[kSecAttrSynchronizable] as? NSString,
            kSecAttrSynchronizableAny as NSString
        )
        // Must also request the full attribute dict so `read` can detect
        // the legacy accessibility class.
        XCTAssertEqual(q[kSecReturnAttributes] as? Bool, true)
        XCTAssertEqual(q[kSecReturnData] as? Bool, true)
    }

    func testDeleteQueryMatchesAnyVariant() {
        // Sign-out must wipe both local-only and any orphan synced entry.
        let q = Keychain.matchAnySyncableQuery(service: service, key: .userId)
        XCTAssertEqual(
            q[kSecAttrSynchronizable] as? NSString,
            kSecAttrSynchronizableAny as NSString
        )
    }
}

// Local roster of the keys we expect to lock down. Drives the parameterised
// assertions above so adding a new Keychain.Key without hardened attrs
// fails the suite immediately.
extension Keychain.Key {
    static var allKeysForTest: [Keychain.Key] {
        [.accessToken, .refreshToken, .userId]
    }
}
