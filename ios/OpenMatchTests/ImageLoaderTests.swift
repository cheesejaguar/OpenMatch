import XCTest
import UIKit
import ImageIO
@testable import OpenMatch

// PERF-I4 — Smoke tests for the image loader's decode path and memory
// caching. The network path is not exercised here (no live URL); the
// `decodeThumbnail(data:maxPixelSize:)` static is verified directly,
// and the actor cache contract is exercised via the public API using a
// local file:// URL.
final class ImageLoaderTests: XCTestCase {
    func testDecodeThumbnailProducesDownsampledImage() throws {
        // Build a 1024×1024 JPEG in memory.
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1024, height: 1024))
        let image = renderer.image { ctx in
            UIColor.systemPink.setFill()
            ctx.cgContext.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
        }
        let data = try XCTUnwrap(image.jpegData(compressionQuality: 0.9))

        let thumb = try XCTUnwrap(ImageLoader.decodeThumbnail(data: data, maxPixelSize: 200))
        let longest = max(thumb.size.width * thumb.scale, thumb.size.height * thumb.scale)
        // CGImageSource may go up to ~maxPixelSize; assert it's nowhere
        // near full-resolution.
        XCTAssertLessThanOrEqual(longest, 256, "Thumbnail should be ≤ 256px after downsampling to maxPixelSize=200")
    }

    func testDecodeThumbnailRejectsCorruptData() {
        // Random bytes are not a valid image container.
        let bytes = Data((0..<512).map { _ in UInt8.random(in: 0...255) })
        let result = ImageLoader.decodeThumbnail(data: bytes, maxPixelSize: 200)
        XCTAssertNil(result, "Corrupt input must return nil rather than crashing")
    }

    func testMemoryCacheServesRepeatLoadsUntilCleared() async throws {
        // Load a JPEG from a local file:// URL (no network), delete the
        // file, and verify the second load is served from the decoded
        // memory cache. After `clearMemoryCache()` the same load must
        // miss the cache and fail, because the backing file is gone.
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64))
        let image = renderer.image { ctx in
            UIColor.systemTeal.setFill()
            ctx.cgContext.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
        let data = try XCTUnwrap(image.jpegData(compressionQuality: 0.9))
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("image-loader-\(UUID().uuidString).jpg")
        try data.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let loader = ImageLoader.shared
        await loader.clearMemoryCache()

        let first = await loader.image(for: url, maxPixelSize: 32)
        XCTAssertNotNil(first, "Initial load from a local file must decode")

        try FileManager.default.removeItem(at: url)

        let cached = await loader.image(for: url, maxPixelSize: 32)
        XCTAssertNotNil(cached, "Repeat load must be served from the memory cache")
        XCTAssertTrue(cached === first, "Cache hit must return the same decoded UIImage instance")

        await loader.clearMemoryCache()
        let afterClear = await loader.image(for: url, maxPixelSize: 32)
        XCTAssertNil(afterClear, "After clearMemoryCache the load must miss and fail on the deleted file")
    }
}
