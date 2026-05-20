import SwiftUI
import XCTest
@testable import OpenMatch

// Phase E — Aurora Dawn: configurable handedness preference.
//
// Locks the local-cache half of the store contract: a freshly-constructed
// store reads UserDefaults at the documented key, defaults to .right when
// absent, persists writes immediately, and round-trips its raw value.

@MainActor
final class HandednessStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "openmatch.handedness.tests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    func testDefaultsToRightWhenUserDefaultsEmpty() {
        let store = HandednessStore(api: nil, defaults: defaults)
        XCTAssertEqual(store.current, .right)
    }

    func testReadsCachedValueFromUserDefaults() {
        defaults.set("left", forKey: HandednessStore.userDefaultsKey)
        let store = HandednessStore(api: nil, defaults: defaults)
        XCTAssertEqual(store.current, .left)
    }

    func testWritePersistsToUserDefaults() {
        let store = HandednessStore(api: nil, defaults: defaults)
        store.current = .center
        XCTAssertEqual(defaults.string(forKey: HandednessStore.userDefaultsKey), "center")
    }

    func testPickerSelectionDrivesBinding() {
        // Mirrors the SettingsView usage: a Binding wraps store.current and
        // the picker writes through it. The store should reflect the
        // picker's choice and the cache should hold the new raw value.
        let store = HandednessStore(api: nil, defaults: defaults)
        let binding = Binding<Handedness>(
            get: { store.current },
            set: { store.current = $0 }
        )
        binding.wrappedValue = .left
        XCTAssertEqual(store.current, .left)
        XCTAssertEqual(defaults.string(forKey: HandednessStore.userDefaultsKey), "left")
    }

    func testHandednessEnumRoundTripsRawValue() {
        for value in Handedness.allCases {
            XCTAssertEqual(Handedness(rawValue: value.rawValue), value)
        }
    }
}
