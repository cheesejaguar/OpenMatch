import SwiftUI

// Botanic placeholder mark used wherever a profile photo is missing or
// loading: avatars, the photo carousel's failure state, empty deck cards.
// Scales the two-leaf heart from the app icon down to a 44pt avatar.
struct BotanicPlaceholder: View {
    enum Size {
        case avatar(CGFloat)
        case large

        var dimension: CGFloat? {
            if case let .avatar(d) = self { return d }
            return nil
        }
        var isLarge: Bool {
            if case .large = self { return true }
            return false
        }
    }

    let size: Size

    init(_ size: Size = .large) { self.size = size }

    var body: some View {
        if size.isLarge {
            largeMark
        } else if let d = size.dimension {
            avatarMark(diameter: d)
        }
    }

    // 44–96pt circular avatar. Single moss leaf + single terracotta leaf
    // sized to fit the disc with a small bone gutter.
    private func avatarMark(diameter d: CGFloat) -> some View {
        let glyph = d * 0.42
        return ZStack {
            Circle().fill(OMColor.surface)
            Image(systemName: "leaf.fill")
                .font(.system(size: glyph, weight: .bold))
                .foregroundStyle(OMColor.terracotta)
                .rotationEffect(.degrees(-22))
                .offset(x: -d * 0.07, y: 0)
            Image(systemName: "leaf.fill")
                .font(.system(size: glyph, weight: .bold))
                .foregroundStyle(OMColor.moss)
                .rotationEffect(.degrees(158))
                .offset(x: d * 0.07, y: 0)
        }
        .frame(width: d, height: d)
        .overlay(Circle().stroke(OMColor.cardStroke, lineWidth: 1))
        .accessibilityHidden(true)
    }

    // Full-rect placeholder used when a card photo fails to load. Fills
    // the container with bone, then layers the leaf-heart at ~40% of the
    // smaller dimension with a honey crescent at the apex.
    private var largeMark: some View {
        GeometryReader { proxy in
            let s = min(proxy.size.width, proxy.size.height)
            let glyph = s * 0.32
            ZStack {
                OMColor.surface
                ZStack {
                    Image(systemName: "leaf.fill")
                        .font(.system(size: glyph, weight: .bold))
                        .foregroundStyle(OMColor.terracotta)
                        .rotationEffect(.degrees(-22))
                        .offset(x: -s * 0.06, y: 0)
                    Image(systemName: "leaf.fill")
                        .font(.system(size: glyph, weight: .bold))
                        .foregroundStyle(OMColor.moss)
                        .rotationEffect(.degrees(158))
                        .offset(x: s * 0.06, y: 0)
                    Capsule()
                        .fill(OMColor.honey.opacity(0.55))
                        .frame(width: glyph * 0.55, height: glyph * 0.18)
                        .offset(y: -glyph * 0.55)
                        .blur(radius: 4)
                }
                .frame(width: s, height: s)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityHidden(true)
    }
}
