import SwiftUI

struct ProfileCardView: View {
    let card: ProfileCardModel
    let dragOffset: CGSize
    let onLike: () -> Void
    let onReject: () -> Void
    let onUndo: () -> Void
    let onShowDetail: () -> Void
    let canUndo: Bool

    @State private var photoIndex: Int = 0

    private var intent: Double {
        Double(max(-1, min(1, dragOffset.width / 120)))
    }

    var body: some View {
        ZStack {
            PhotoCarouselView(photos: card.photos, index: $photoIndex)

            // Bottom gradient — espresso, not pure black. Reads as warm shadow.
            LinearGradient(
                colors: [.clear, Color(red: 0.165, green: 0.122, blue: 0.102).opacity(0.0),
                         Color(red: 0.165, green: 0.122, blue: 0.102).opacity(0.72)],
                startPoint: .top,
                endPoint: .bottom
            )

            // Edge glow — radial wash anchored to leading/trailing edge,
            // tinted terracotta on like-intent and sage on pass-intent.
            // Opacity grows with drag distance and caps at 0.55.
            edgeGlow

            // Like / reject hint overlays
            HStack {
                CornerBadge(text: "LIKE", color: OMColor.terracotta)
                    .scaleEffect(1 + max(0, intent) * 0.18)
                    .opacity(max(0, intent))
                    .rotationEffect(.degrees(-12))
                    .padding(.top, 30)
                    .padding(.leading, 24)
                Spacer()
                CornerBadge(text: "PASS", color: OMColor.sage)
                    .scaleEffect(1 + max(0, -intent) * 0.18)
                    .opacity(max(0, -intent))
                    .rotationEffect(.degrees(12))
                    .padding(.top, 30)
                    .padding(.trailing, 24)
            }
            .animation(.spring(response: 0.22, dampingFraction: 0.55), value: intent)

            VStack { Spacer(); summary }
        }
        .clipShape(OMShape.card())
        .overlay(
            OMShape.card().stroke(OMColor.cardStroke, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var edgeGlow: some View {
        let strength = min(abs(intent), 1.0) * 0.55
        let tint: Color = intent >= 0 ? OMColor.terracotta : OMColor.sage
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

            if !card.bio.isEmpty {
                Text(card.bio)
                    .lineLimit(3)
                    .font(OMFont.callout)
                    .foregroundStyle(Color.white.opacity(0.92))
            }

            actionRow
                .padding(.top, 8)
        }
        .foregroundStyle(.white)
        .padding(16)
    }

    private var actionRow: some View {
        HStack(spacing: 16) {
            Button(action: { Haptics.warning(); onUndo() }) {
                Image(systemName: "arrow.uturn.backward")
                    .font(.title3.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.honey, size: 52))
            .disabled(!canUndo)
            .opacity(canUndo ? 1 : 0.4)
            .accessibilityLabel("Undo last decision")

            Button(action: { Haptics.threshold(); onReject() }) {
                Image(systemName: "xmark")
                    .font(.title.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.sage, size: 62))
            .accessibilityLabel("Reject profile")

            Button(action: { Haptics.threshold(); onLike() }) {
                Image(systemName: "heart.fill")
                    .font(.title.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.terracotta, size: 62))
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
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(color, lineWidth: 4)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(OMColor.surfaceElevated.opacity(0.55))
                    )
            )
    }
}
