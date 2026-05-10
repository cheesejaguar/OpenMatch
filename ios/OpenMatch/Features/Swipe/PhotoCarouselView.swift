import SwiftUI

struct PhotoCarouselView: View {
    let photos: [PhotoDTO]
    @Binding var index: Int

    var body: some View {
        ZStack {
            if photos.isEmpty {
                LinearGradient(
                    colors: [OMColor.like.opacity(0.4), OMColor.like.opacity(0.7)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            } else {
                let url = URL(string: photos[clampedIndex].cdnUrl, relativeTo: APIConfig.defaultBaseURL)
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        Color.gray.opacity(0.18).overlay(ProgressView())
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        Color.gray.opacity(0.18).overlay(
                            Image(systemName: "person.crop.rectangle")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                        )
                    @unknown default:
                        Color.gray.opacity(0.18)
                    }
                }
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
                    .accessibilityLabel("Previous photo")
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
                    .accessibilityLabel("Next photo")
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
