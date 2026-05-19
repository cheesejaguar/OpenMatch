import SwiftUI

// Aurora Dawn placeholder mark used wherever a profile photo is missing
// or loading: avatars, the photo carousel's failure state, empty deck
// cards. Renders the lowercase italic "om" wordmark (Phase C of the
// Aurora Dawn overhaul) inside a periwinkle disc.
//
// The placeholder is intentionally text-based — we use the registered
// Fraunces 9pt Black Italic cut directly rather than embedding a
// rasterised PNG. This keeps the avatar crisp at every size from 32pt
// up to full-bleed card placeholders.
struct OMPlaceholder: View {
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

    // 32–96pt circular avatar. Periwinkle disc + italic "om" wordmark
    // in plum, sized to ~50% of the disc diameter so it reads at the
    // smallest avatar use cases (chat list, mention chips).
    private func avatarMark(diameter d: CGFloat) -> some View {
        ZStack {
            Circle().fill(OMColor.periwinkle.opacity(0.20))
            Text("om")
                .font(OMFont.display(d * 0.50, weight: .black, italic: true))
                .foregroundStyle(OMColor.plum)
                .baselineOffset(-d * 0.02)
        }
        .frame(width: d, height: d)
        .overlay(Circle().stroke(OMColor.cardStroke, lineWidth: 1))
        .accessibilityHidden(true)
    }

    // Full-rect placeholder used when a card photo fails to load.
    // Fills the container with paper, layers the wordmark at ~32% of
    // the smaller dimension over a periwinkle disc.
    private var largeMark: some View {
        GeometryReader { proxy in
            let s = min(proxy.size.width, proxy.size.height)
            let discDiameter = s * 0.62
            ZStack {
                OMColor.paper
                ZStack {
                    Circle()
                        .fill(OMColor.periwinkle.opacity(0.20))
                        .frame(width: discDiameter, height: discDiameter)
                    Text("om")
                        .font(OMFont.display(discDiameter * 0.50, weight: .black, italic: true))
                        .foregroundStyle(OMColor.plum)
                        .baselineOffset(-discDiameter * 0.02)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityHidden(true)
    }
}

// Back-compat alias so existing call sites (`BotanicPlaceholder(.avatar(44))`)
// keep compiling through the Phase F sweep. New code should adopt
// `OMPlaceholder` directly.
typealias BotanicPlaceholder = OMPlaceholder
