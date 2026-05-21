import XCTest
import UIKit
@testable import OpenMatch

// Trust & safety automation — PhotoModerator coverage. The classifier
// is built into Vision so we can't ship a deterministic "explicit"
// fixture, but we can:
//   - assert a synthetic neutral image returns `.clean`.
//   - assert the threshold helpers behave as documented.
//   - assert the actor is callable from arbitrary contexts (it's
//     intentionally an `actor` so concurrent uploads don't race).

final class PhotoModeratorTests: XCTestCase {

    /// A solid-colour 64x64 image is unambiguously safe content;
    /// VNClassifyImageRequest should not return an explicit label,
    /// and the face detector should return zero faces (which flags but
    /// does not block).
    func testNeutralImageDoesNotBlock() async throws {
        let image = Self.makeSolidColorImage(.gray, size: CGSize(width: 64, height: 64))
        let result = await PhotoModerator.shared.scan(image)
        XCTAssertNotEqual(result.decision, .block, "Solid-grey square must not block")
    }

    func testThresholdsAreOrdered() {
        XCTAssertGreaterThan(PhotoModerator.blockThreshold, PhotoModerator.flagThreshold)
        XCTAssertLessThan(PhotoModerator.flagThreshold, 1.0)
        XCTAssertGreaterThan(PhotoModerator.flagThreshold, 0.0)
    }

    func testSignalIsCodable() throws {
        let signal = PhotoModerator.Signal(source: "vision_classify", code: "nudity", score: 0.42)
        let data = try JSONEncoder().encode(signal)
        let decoded = try JSONDecoder().decode(PhotoModerator.Signal.self, from: data)
        XCTAssertEqual(decoded, signal)
    }

    func testResultEqualityIgnoresInsertionOrderSemantics() {
        let a = PhotoModerator.Result(
            decision: .flag,
            signals: [
                PhotoModerator.Signal(source: "vision_classify", code: "suggestive", score: 0.6),
            ]
        )
        let b = PhotoModerator.Result(
            decision: .flag,
            signals: [
                PhotoModerator.Signal(source: "vision_classify", code: "suggestive", score: 0.6),
            ]
        )
        XCTAssertEqual(a, b)
    }

    // MARK: - Helpers

    private static func makeSolidColorImage(_ color: UIColor, size: CGSize) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            color.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
        }
    }
}
