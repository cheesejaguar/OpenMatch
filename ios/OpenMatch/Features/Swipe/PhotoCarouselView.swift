import SwiftUI

struct PhotoCarouselView: View {
    let photos: [PhotoDTO]
    @Binding var index: Int
    // A11Y — honor system Reduce Motion preference. We don't currently
    // animate carousel transitions (it's a hard cut between photos),
    // but the environment is captured here so any future cross-fade
    // can branch on it without re-plumbing.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if photos.isEmpty {
                BotanicPlaceholder(.large)
            } else {
                let url = URL(string: photos[clampedIndex].cdnUrl, relativeTo: APIConfig.defaultBaseURL)
                // PERF-I4 — swipe-card photo. The card occupies roughly
                // the full screen width; on a 3x device that's ≤ 1200px,
                // and on 2x it's ≤ 800px. 1200px covers the longest-edge
                // worst case without paying for 1600px source bytes.
                OMImage(url: url, thumbnailMaxPixelSize: 1200)
                    .scaledToFill()
                    // Hard cut for reduce-motion users; a subtle cross-fade
                    // otherwise. The transition is bound to the clamped
                    // index so .id() forces a re-render at each change.
                    .id(clampedIndex)
                    .transition(reduceMotion ? .identity : .opacity)
            }
            HStack(spacing: 0) {
                Color.clear
                    .contentShape(Rectangle())
                    .frame(maxWidth: .infinity)
                    .onTapGesture {
                        guard photos.count > 1, index > 0 else { return }
                        Haptics.tick()
                        index -= 1
                    }
                    .accessibilityLabel(Text("swipe.photo.previous.a11y_label"))
                Color.clear
                    .contentShape(Rectangle())
                    .frame(maxWidth: .infinity)
                    .onTapGesture {
                        // Center reserved — falls through to parent.
                    }
                    .allowsHitTesting(false)
                Color.clear
                    .contentShape(Rectangle())
                    .frame(maxWidth: .infinity)
                    .onTapGesture {
                        guard photos.count > 1, index < photos.count - 1 else { return }
                        Haptics.tick()
                        index += 1
                    }
                    .accessibilityLabel(Text("swipe.photo.next.a11y_label"))
            }
            VStack {
                if photos.count > 1 {
                    PhotoProgressIndicator(count: photos.count, current: clampedIndex)
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                }
                Spacer()
            }
        }
    }

    private var clampedIndex: Int {
        guard !photos.isEmpty else { return 0 }
        return max(0, min(index, photos.count - 1))
    }
}

private struct PhotoProgressIndicator: View {
    let count: Int
    let current: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i == current ? Color.white : Color.white.opacity(0.35))
                    .frame(height: 3)
            }
        }
    }
}
