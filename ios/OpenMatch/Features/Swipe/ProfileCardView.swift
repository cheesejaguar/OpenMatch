import SwiftUI

struct ProfileCardView: View {
    enum DisplayMode { case top, preview }

    let card: ProfileCardModel
    let dragOffset: CGSize
    let onLike: () -> Void
    let onReject: () -> Void
    let onUndo: () -> Void
    let onShowDetail: () -> Void
    let canUndo: Bool
    var displayMode: DisplayMode = .top

    @EnvironmentObject private var handedness: HandednessStore
    @State private var photoIndex: Int = 0

    private var intent: Double {
        Double(max(-1, min(1, dragOffset.width / 120)))
    }

    var body: some View {
        ZStack {
            PhotoCarouselView(photos: card.photos, index: $photoIndex)

            // Bottom gradient — espresso, not pure black. Reads as warm shadow.
            // Skip the gradient on the back-card preview — there's no text
            // to fade behind it and the darkening looks like a render glitch.
            if displayMode == .top {
                LinearGradient(
                    colors: [.clear, Color(red: 0.165, green: 0.122, blue: 0.102).opacity(0.0),
                             Color(red: 0.165, green: 0.122, blue: 0.102).opacity(0.72)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }

            // Edge glow + LIKE/PASS stamps + bottom summary + action row
            // are only meaningful for the actively-dragged top card. The
            // back-card preview gets just the photo so its text never
            // bleeds through the front card when the front photo is missing.
            if displayMode == .top {
                edgeGlow

                HStack {
                    CornerBadge(text: "LIKE", color: OMColor.magenta)
                        .scaleEffect(1 + max(0, intent) * 0.18)
                        .opacity(max(0, intent))
                        .rotationEffect(.degrees(-12))
                        .padding(.top, 30)
                        .padding(.leading, 24)
                    Spacer()
                    CornerBadge(text: "PASS", color: OMColor.periwinkle)
                        .scaleEffect(1 + max(0, -intent) * 0.18)
                        .opacity(max(0, -intent))
                        .rotationEffect(.degrees(12))
                        .padding(.top, 30)
                        .padding(.trailing, 24)
                }
                .animation(.spring(response: 0.22, dampingFraction: 0.55), value: intent)

                VStack { Spacer(); summary }
            }
        }
        .clipShape(OMShape.card())
        .overlay(
            OMShape.card().stroke(OMColor.cardStroke, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityHidden(displayMode == .preview)
    }

    private var edgeGlow: some View {
        let strength = min(abs(intent), 1.0) * 0.55
        let tint: Color = intent >= 0 ? OMColor.magenta : OMColor.periwinkle
        return ZStack {
            if intent > 0 {
                RadialGradient(
                    colors: [tint.opacity(strength), .clear],
                    center: .trailing,
                    startRadius: 0,
                    endRadius: 320
                )
            } else if intent < 0 {
                RadialGradient(
                    colors: [tint.opacity(strength), .clear],
                    center: .leading,
                    startRadius: 0,
                    endRadius: 320
                )
            }
        }
        .allowsHitTesting(false)
        .blendMode(.plusLighter)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.displayName)
                    .font(OMFont.display(28, weight: .bold))
                if let p = card.pronouns, !p.isEmpty {
                    Text(p)
                        .font(OMFont.callout)
                        .foregroundStyle(Color.white.opacity(0.85))
                }
                Spacer()
                Button(action: onShowDetail) {
                    Image(systemName: "info.circle")
                        .font(.title2)
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Why am I seeing this profile?")
            }
            HStack(spacing: 8) {
                Image(systemName: "location.fill").imageScale(.small)
                Text(card.distanceText)
                if let city = card.city {
                    Text("· \(city)")
                }
            }
            .font(OMFont.callout)
            .foregroundStyle(Color.white.opacity(0.95))

            // DISC-Q4 — "Active today" badge. Cheap visual cue that
            // the candidate is engaged; the data already comes down
            // on every deck card.
            if card.recentlyActive {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text("Active today")
                        .font(OMFont.caption)
                        .foregroundStyle(Color.white.opacity(0.95))
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Active today")
            }

            if !card.bio.isEmpty {
                Text(card.bio)
                    .lineLimit(3)
                    .font(OMFont.callout)
                    .foregroundStyle(Color.white.opacity(0.92))
            }

            anchoredActionRow
                .padding(.top, 8)
        }
        .foregroundStyle(.white)
        .padding(16)
    }

    /// Wraps the action row so its horizontal anchor follows the user's
    /// thumb-reach preference. Default (`.right`) hugs the trailing edge
    /// — natural for right-handed users holding the phone in one hand.
    /// `.left` mirrors it for left-handed users, `.center` keeps both
    /// buttons equidistant from the screen edges.
    @ViewBuilder
    private var anchoredActionRow: some View {
        switch handedness.current {
        case .right:
            HStack { Spacer(); actionRow }
        case .left:
            HStack { actionRow; Spacer() }
        case .center:
            HStack { Spacer(); actionRow; Spacer() }
        }
    }

    private var actionRow: some View {
        HStack(spacing: 16) {
            Button(action: { Haptics.warning(); onUndo() }) {
                Image(systemName: "arrow.uturn.backward")
                    .font(.title3.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.marigold, size: 52))
            .disabled(!canUndo)
            .opacity(canUndo ? 1 : 0.4)
            .accessibilityLabel("Undo last decision")

            Button(action: { Haptics.threshold(); onReject() }) {
                Image(systemName: "xmark")
                    .font(.title.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.periwinkle, size: 62))
            .accessibilityLabel("Reject profile")

            Button(action: { Haptics.threshold(); onLike() }) {
                Image(systemName: "heart.fill")
                    .font(.title.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.magenta, size: 62))
            .accessibilityLabel("Like profile")
        }
    }
}

private struct CornerBadge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(OMFont.display(28, weight: .bold, italic: true))
            .tracking(2)
            .foregroundStyle(color)
            .padding(.vertical, 6)
            .padding(.horizontal, 14)
            .background(
                OMShape.input(OMRadius.xs)
                    .stroke(color, lineWidth: 4)
                    .background(
                        OMShape.input(OMRadius.xs)
                            .fill(OMColor.surfaceElevated.opacity(0.55))
                    )
            )
    }
}
