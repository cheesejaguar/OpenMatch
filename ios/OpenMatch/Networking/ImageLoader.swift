import Foundation
import UIKit
import ImageIO
import CryptoKit

// PERF-I4 — Lightweight image loader to replace SwiftUI's `AsyncImage`.
//
// SwiftUI `AsyncImage`:
//   - has no on-disk cache (URL re-downloaded every appearance)
//   - has no memory cache (re-rendering re-fetches)
//   - decodes on the main thread (jank during scroll)
//   - has no thumbnail negotiation (full-res fetch for an avatar)
//
// This loader fixes all four:
//   1. Memory cache: `NSCache<NSURL, UIImage>` keyed by URL+pixel-size,
//      capped at ~32MB / 100 entries.
//   2. Disk cache: a dedicated `URLCache` rooted at
//      `Caches/openmatch-photos/`. Vercel Blob URLs are signed but
//      typically include a `Cache-Control: public, max-age=...` header
//      from the CDN; `URLCache` honors that automatically. If the URL
//      query-string contains expiry params we still fall back to network
//      via `useProtocolCachePolicy`.
//   3. Decoding off main: `CGImageSourceCreateThumbnailAtIndex` with
//      `kCGImageSourceThumbnailMaxPixelSize` produces an already-
//      decoded, properly-sized CGImage. The full-resolution bytes
//      never hit the main thread.
//   4. Thumbnail size: callers pass `maxPixelSize` (in pixels — the
//      view multiplies its display points by `UIScreen.main.scale`).
//
// The loader is an actor; concurrent requests for the same key are
// coalesced via an in-flight task map.
actor ImageLoader {
    static let shared = ImageLoader()

    // Memory cache. NSCache evicts under memory pressure; the cost
    // limit is a soft hint (~32MB).
    private let memory: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 32 * 1024 * 1024
        c.countLimit = 100
        return c
    }()

    // Dedicated URLCache so the photo bytes don't fight the API cache
    // for budget. Disk cap is 100MB; memory cap is 8MB (we mostly rely
    // on the decoded NSCache above for the hot path).
    private let session: URLSession

    // Coalesce concurrent fetches of the same key. Keyed by
    // `URL + "::" + pixelSize`.
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    private init() {
        let cfg = URLSessionConfiguration.default
        cfg.requestCachePolicy = .useProtocolCachePolicy
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 60
        cfg.httpMaximumConnectionsPerHost = 8
        cfg.waitsForConnectivity = true
        let cachesURL = (try? FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        let photoDir = cachesURL.appendingPathComponent("openmatch-photos", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: photoDir,
            withIntermediateDirectories: true
        )
        cfg.urlCache = URLCache(
            memoryCapacity: 8 * 1024 * 1024,
            diskCapacity: 100 * 1024 * 1024,
            directory: photoDir
        )
        self.session = URLSession(configuration: cfg)
    }

    // Returns an image for `url` already decoded to (roughly) `maxPixelSize`
    // along the longest edge. Returns `nil` on transport / decode failure;
    // callers render a placeholder in that case.
    func image(for url: URL, maxPixelSize: CGFloat) async -> UIImage? {
        let key = cacheKey(url: url, maxPixelSize: maxPixelSize)
        if let cached = memory.object(forKey: key as NSString) {
            return cached
        }
        if let inFlight = inFlight[key] {
            return await inFlight.value
        }
        let task = Task<UIImage?, Never> {
            await loadAndDecode(url: url, maxPixelSize: maxPixelSize, key: key)
        }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        return result
    }

    // Allow tests / memory-pressure handlers to wipe the cache.
    func clearMemoryCache() {
        memory.removeAllObjects()
    }

    // MARK: - Internal

    private func loadAndDecode(url: URL, maxPixelSize: CGFloat, key: String) async -> UIImage? {
        do {
            let (data, _) = try await session.data(from: url)
            // Decode off-main on a userInitiated detached task. The
            // returned UIImage is thread-safe to use on MainActor.
            let decoded = await Task.detached(priority: .userInitiated) { () -> UIImage? in
                Self.decodeThumbnail(data: data, maxPixelSize: maxPixelSize)
            }.value
            guard let image = decoded else { return nil }
            let cost = Int(image.size.width * image.size.height * 4) // 4bpp estimate
            memory.setObject(image, forKey: key as NSString, cost: cost)
            return image
        } catch {
            return nil
        }
    }

    private func cacheKey(url: URL, maxPixelSize: CGFloat) -> String {
        // Hash the URL so a signed Vercel Blob URL doesn't bloat the
        // key (and so the key string isn't itself a 400-char query
        // string). Pixel-size is part of the key because we cache the
        // decoded thumbnail, not the raw bytes.
        let bytes = Data(url.absoluteString.utf8)
        let digest = SHA256.hash(data: bytes)
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "\(hex)::\(Int(maxPixelSize))"
    }

    nonisolated static func decodeThumbnail(data: Data, maxPixelSize: CGFloat) -> UIImage? {
        // `CGImageSourceCreateThumbnailAtIndex` is the standard way to
        // produce a downsampled, already-decoded image without paying
        // the full-resolution decode cost. `Always` tells the system to
        // synthesize a thumbnail when the source has none embedded.
        guard let source = CGImageSourceCreateWithData(data as CFData, [
            kCGImageSourceShouldCache: false
        ] as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixelSize)
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: cg)
    }
}
