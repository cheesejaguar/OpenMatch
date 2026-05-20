import XCTest
import SwiftUI
@testable import OpenMatch

// SEV-M3 regression. Asserts `OMPrivacyVeil.isVisible(for:)` covers
// every non-active scene phase so the app-switcher snapshot can't
// regress to showing user content.
final class PrivacyVeilTests: XCTestCase {
    func testVeilHiddenOnActive() {
        XCTAssertFalse(OMPrivacyVeil.isVisible(for: .active))
    }

    func testVeilVisibleOnInactive() {
        // `.inactive` is the phase where iOS captures the app-switcher
        // snapshot. The veil MUST be in the view hierarchy by the time
        // this transition fires.
        XCTAssertTrue(OMPrivacyVeil.isVisible(for: .inactive))
    }

    func testVeilVisibleOnBackground() {
        XCTAssertTrue(OMPrivacyVeil.isVisible(for: .background))
    }
}
