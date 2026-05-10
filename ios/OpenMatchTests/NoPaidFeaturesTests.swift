import XCTest

/// Guardrail tests. Mirrors backend/test/no-paid-features.spec.ts.
/// If any forbidden term appears in iOS source, CI should fail.
final class NoPaidFeaturesTests: XCTestCase {
    func testNoStoreKitImport() {
        XCTAssertFalse(sourcesContain("import StoreKit"), "OpenMatch must not import StoreKit.")
    }
    func testNoSuperLikeMention() {
        XCTAssertFalse(sourcesMatch(#"super[_ ]?like"#), "No super-like in source.")
    }
    func testNoPaywallMention() {
        XCTAssertFalse(sourcesMatch(#"paywall"#), "No paywall in source.")
    }
    func testNoBoost() {
        XCTAssertFalse(sourcesMatch(#"paid[_ ]?boost"#), "No paid boost in source.")
    }
    func testNoStripe() {
        XCTAssertFalse(sourcesMatch(#"stripe|paypal|braintree"#), "No payment integrations in source.")
    }

    // MARK: - helpers

    private func sourcesContain(_ literal: String) -> Bool {
        for url in sourceFiles() {
            guard let content = try? String(contentsOf: url) else { continue }
            if content.contains(literal) { return true }
        }
        return false
    }

    private func sourcesMatch(_ pattern: String) -> Bool {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return false }
        for url in sourceFiles() {
            guard let raw = try? String(contentsOf: url) else { continue }
            // Strip comment lines so docs/comments warning against these terms don't trip the test.
            let stripped = raw
                .split(separator: "\n", omittingEmptySubsequences: false)
                .filter { line in
                    let t = line.trimmingCharacters(in: .whitespaces)
                    return !(t.hasPrefix("//") || t.hasPrefix("*") || t.hasPrefix("/*"))
                }
                .joined(separator: "\n")
            let range = NSRange(stripped.startIndex..., in: stripped)
            if re.firstMatch(in: stripped, options: [], range: range) != nil { return true }
        }
        return false
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
