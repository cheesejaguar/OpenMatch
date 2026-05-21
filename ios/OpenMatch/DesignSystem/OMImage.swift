import SwiftUI
import UIKit

// PERF-I4 — Drop-in replacement for SwiftUI `AsyncImage` backed by
// `ImageLoader`. Differences from `AsyncImage`:
//   - Persistent memory + disk cache (no refetch on every appearance).
//   - Decodes on a background actor (no main-thread JPEG decode).
//   - Thumbnail negotiation: callers pass `thumbnailMaxPixelSize`
//     so a 56pt avatar doesn't pull 1600pt JPEG bytes.
//   - Periwinkle placeholder while loading, crossfade on appear.
//
// Usage:
//   OMImage(url: url, thumbnailMaxPixelSize: 800)
//     .frame(width: 360, height: 480)
//
// `thumbnailMaxPixelSize` is in pixels (display points × screen scale).
// Pass the longest edge of the rendered view.
struct OMImage: View {
    let url: URL?
    let thumbnailMaxPixelSize: CGFloat

    @State private var image: UIImage?
    @State private var didFail = false
    @State private var loadToken: UUID = UUID()

    init(url: URL?, thumbnailMaxPixelSize: CGFloat) {
        self.url = url
        self.thumbnailMaxPixelSize = thumbnailMaxPixelSize
    }

    var body: some View {
        ZStack {
            // Placeholder layer: visible until the image lands.
            if image == nil {
                placeholder
                    .transition(.opacity)
            }
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.18), value: image != nil)
        .task(id: loadTaskID) {
            await load()
        }
    }

    // Re-run the loader when the URL or requested size changes. Wrapping
    // in a stable hashable lets SwiftUI cancel a previous fetch when
    // the view's bound URL flips mid-flight.
    private var loadTaskID: String {
        "\(url?.absoluteString ?? "nil")::\(Int(thumbnailMaxPixelSize))"
    }

    private var placeholder: some View {
        Rectangle()
            .fill(OMColor.periwinkle.opacity(0.2))
    }

    private func load() async {
        guard let url else {
            image = nil
            didFail = true
            return
        }
        let loaded = await ImageLoader.shared.image(
            for: url,
            maxPixelSize: thumbnailMaxPixelSize
        )
        // The view may have been reused for a different URL while the
        // network was in flight; SwiftUI's `.task(id:)` will already
        // have cancelled this body, but guard anyway.
        if !Task.isCancelled {
            self.image = loaded
            self.didFail = loaded == nil
        }
    }
}

// Convenience for views that already know the destination point size
// but not the screen scale.
extension OMImage {
    init(url: URL?, displayPointSize: CGSize) {
        let scale = UIScreen.main.scale
        let longest = max(displayPointSize.width, displayPointSize.height)
        self.init(
            url: url,
            thumbnailMaxPixelSize: max(1, longest * scale)
        )
    }
}
