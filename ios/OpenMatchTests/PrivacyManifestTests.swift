import XCTest

/// Privacy-manifest and no-tracking guardrails. Mirror in spirit the
/// backend `no-paid-features` and `no-precise-location-leak` tests:
/// catch privacy regressions at build time, before they ship.
///
/// References:
///   - docs/legal/privacy-notice.md
///   - docs/legal/regulatory-landscape.md §13 (highest-stakes traps)
///   - ios/OpenMatch/Resources/PrivacyInfo.xcprivacy
final class PrivacyManifestTests: XCTestCase {
    // MARK: - Static-source guardrails

    func testNoIDFAImport() {
        XCTAssertFalse(
            sourcesContain("import AdSupport"),
            "OpenMatch does not use IDFA. Importing AdSupport is forbidden."
        )
        XCTAssertFalse(
            sourcesContain("ASIdentifierManager"),
            "OpenMatch does not use IDFA. ASIdentifierManager is forbidden."
        )
    }

    func testNoATTPrompt() {
        // We do not call requestTrackingAuthorization. The PrivacyInfo
        // manifest declares NSPrivacyTracking=false; calling ATT would
        // contradict the manifest.
        XCTAssertFalse(
            sourcesContain("ATTrackingManager"),
            "Do not call ATTrackingManager — we do not track."
        )
        XCTAssertFalse(
            sourcesContain("requestTrackingAuthorization"),
            "Do not request tracking authorization — we do not track."
        )
    }

    func testNoThirdPartyAdSdkImports() {
        // Catch a few common ad SDK imports. The full list belongs to
        // the build-script side (no compiled SDK should be linked), but
        // the source-level catch is a fast first line of defence.
        let forbidden = [
            "import GoogleMobileAds",
            "import FBAudienceNetwork",
            "import FacebookSDK",
            "import AppLovinSDK",
            "import AdMob",
            "import FirebaseAnalytics",  // even Firebase Analytics is ad-graph-adjacent
            "import Mixpanel",            // third-party PII analytics
            "import Amplitude",
            "import Segment",
        ]
        for line in forbidden {
            XCTAssertFalse(
                sourcesContain(line),
                "Forbidden third-party SDK import: \(line)"
            )
        }
    }

    // MARK: - PrivacyInfo.xcprivacy presence + key claims

    func testPrivacyManifestExists() {
        XCTAssertNotNil(privacyManifestData(), "PrivacyInfo.xcprivacy is missing.")
    }

    func testPrivacyManifestDeclaresNoTracking() throws {
        guard let data = privacyManifestData() else {
            return XCTFail("PrivacyInfo.xcprivacy not found")
        }
        let plist = try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any]
        XCTAssertNotNil(plist, "PrivacyInfo.xcprivacy must be a property list dictionary")
        // NSPrivacyTracking must be false; NSPrivacyTrackingDomains empty.
        XCTAssertEqual(plist?["NSPrivacyTracking"] as? Bool, false)
        let domains = plist?["NSPrivacyTrackingDomains"] as? [String] ?? []
        XCTAssertTrue(domains.isEmpty, "NSPrivacyTrackingDomains must be empty.")
    }

    // MARK: - Helpers

    private func sourcesContain(_ literal: String) -> Bool {
        for url in sourceFiles() {
            guard let content = try? String(contentsOf: url) else { continue }
            // Skip comments — discussion of forbidden patterns is fine.
            let stripped = content
                .split(separator: "\n", omittingEmptySubsequences: false)
                .filter { line in
                    let t = line.trimmingCharacters(in: .whitespaces)
                    return !(t.hasPrefix("//") || t.hasPrefix("*") || t.hasPrefix("/*"))
                }
                .joined(separator: "\n")
            if stripped.contains(literal) { return true }
        }
        return false
    }

    private func privacyManifestData() -> Data? {
        let here = URL(fileURLWithPath: #filePath)
        let manifestURL = here
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("OpenMatch/Resources/PrivacyInfo.xcprivacy")
        return try? Data(contentsOf: manifestURL)
    }

    private func sourceFiles() -> [URL] {
        let here = URL(fileURLWithPath: #filePath)
        let root = here.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("OpenMatch")
        var results: [URL] = []
        if let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
            for case let url as URL in enumerator where url.pathExtension == "swift" {
                results.append(url)
            }
        }
        return results
    }
}
