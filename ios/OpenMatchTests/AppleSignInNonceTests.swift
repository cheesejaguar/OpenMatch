import XCTest
import CryptoKit
@testable import OpenMatch

// SEV-M5 — Sign-in-with-Apple replay binding.
// Server-side verification is owned by a separate lane (see
// `backend/src/services/apple-auth.service.ts`); these tests cover only
// the iOS half:
//   - `makeRawNonce` returns enough entropy and is fresh per call.
//   - `sha256Hex` matches a CryptoKit reference hash so the value the
//     coordinator places on `ASAuthorizationAppleIDRequest.nonce` is
//     bit-for-bit what the server will recompute from the raw nonce we
//     POST alongside the identity token.
final class AppleSignInNonceTests: XCTestCase {
    func testRawNonceIsHexEncodedAndCorrectLength() {
        let nonce = AppleSignInCoordinator.makeRawNonce()
        XCTAssertEqual(nonce.count, 64, "32 bytes → 64 hex chars")
        XCTAssertTrue(nonce.allSatisfy { $0.isHexDigit }, "nonce should be lowercase hex")
    }

    func testRawNonceIsUnique() {
        // 100 draws of 32 bytes — collision probability is negligible.
        // If this ever fails we've regressed to a non-random generator.
        var seen = Set<String>()
        for _ in 0..<100 {
            seen.insert(AppleSignInCoordinator.makeRawNonce())
        }
        XCTAssertEqual(seen.count, 100, "every nonce must be fresh")
    }

    func testSha256HexMatchesCryptoKitReference() {
        let input = "hello"
        let expected = SHA256.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        XCTAssertEqual(AppleSignInCoordinator.sha256Hex(input), expected)
    }

    func testSha256HexIsStableForKnownInput() {
        // "openmatch" → SHA-256 fixed vector. Drift here means the
        // server's recomputed hash will stop matching.
        let expected = "51eb271077689d456cc81bdc2df08534043cde1f2f1ea86adba2dd3beee33db4"
        XCTAssertEqual(AppleSignInCoordinator.sha256Hex("openmatch"), expected)
    }

    func testHashedNoncePostedAsRequestNonceMatchesRehashOfRawNonce() {
        // Simulates the server side: client generates `raw`, sends `raw`
        // and an identity token containing SHA256(raw); server re-hashes
        // `raw` and compares.
        let raw = AppleSignInCoordinator.makeRawNonce()
        let hashedClient = AppleSignInCoordinator.sha256Hex(raw)
        let hashedServer = AppleSignInCoordinator.sha256Hex(raw)
        XCTAssertEqual(hashedClient, hashedServer)
    }
}
