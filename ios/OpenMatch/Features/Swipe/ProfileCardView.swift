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

    var body: some View {
        ZStack {
            PhotoCarouselView(photos: card.photos, index: $photoIndex)

            // Bottom gradient
            LinearGradient(
                colors: [.clear, .black.opacity(0.0), .black.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )

            // Like / reject hint overlays
            HStack {
                CornerBadge(text: "LIKE", color: OMColor.like)
                    .opacity(Double(max(0, dragOffset.width / 120)))
                    .rotationEffect(.degrees(-12))
                    .padding(.top, 30)
                    .padding(.leading, 24)
                Spacer()
                CornerBadge(text: "PASS", color: OMColor.reject)
                    .opacity(Double(max(0, -dragOffset.width / 120)))
                    .rotationEffect(.degrees(12))
                    .padding(.top, 30)
                    .padding(.trailing, 24)
            }
            VStack { Spacer(); summary }
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.displayName)
                    .font(.system(size: 28, weight: .bold))
                if let p = card.pronouns, !p.isEmpty {
                    Text(p).font(.subheadline).foregroundStyle(.white.opacity(0.85))
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
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.95))

            if !card.bio.isEmpty {
                Text(card.bio)
                    .lineLimit(3)
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.92))
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
            .buttonStyle(OMCircleActionStyle(color: OMColor.undo, size: 52))
            .disabled(!canUndo)
            .opacity(canUndo ? 1 : 0.4)
            .accessibilityLabel("Undo last decision")

            Button(action: { Haptics.threshold(); onReject() }) {
                Image(systemName: "xmark")
                    .font(.title.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.reject, size: 62))
            .accessibilityLabel("Reject profile")

            Button(action: { Haptics.threshold(); onLike() }) {
                Image(systemName: "heart.fill")
                    .font(.title.weight(.semibold))
            }
            .buttonStyle(OMCircleActionStyle(color: OMColor.like, size: 62))
            .accessibilityLabel("Like profile")
        }
    }
}

private struct CornerBadge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.system(size: 28, weight: .heavy))
            .foregroundStyle(color)
            .padding(.vertical, 6)
            .padding(.horizontal, 14)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(color, lineWidth: 4)
            )
    }
}
