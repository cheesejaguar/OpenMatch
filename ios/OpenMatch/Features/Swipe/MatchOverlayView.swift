import SwiftUI

struct MatchOverlayView: View {
    let card: ProfileCardModel
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            OMColor.scrim
                .ignoresSafeArea()
                .background(.ultraThinMaterial)

            MatchCelebrationView()
                .ignoresSafeArea()

            VStack(spacing: 18) {
                Image(systemName: "sparkles")
                    .font(.system(size: 56))
                    .foregroundStyle(OMColor.honey)
                Text("It's a match")
                    .font(OMFont.display(40, weight: .bold, italic: true))
                    .tracking(-0.5)
                    .foregroundStyle(OMColor.terracotta)
                Text("You and \(card.displayName) liked each other.")
                    .font(OMFont.callout)
                    .foregroundStyle(OMColor.ink)
                    .multilineTextAlignment(.center)
                VStack(spacing: 10) {
                    Button("Send a message", action: onDismiss)
                        .buttonStyle(OMPrimaryButtonStyle())
                    Button("Keep swiping", action: onDismiss)
                        .font(OMFont.callout.weight(.semibold))
                        .foregroundStyle(OMColor.moss)
                        .padding(.top, 4)
                }
                .padding(.top, 8)
            }
            .padding(30)
            .background(
                ZStack {
                    // Solid bone surface lifts the card off the dimmed
                    // background. ultraThinMaterial alone tinted to match
                    // the scrim behind it.
                    OMShape.card(OMRadius.lg)
                        .fill(OMColor.surfaceElevated)
                    // Subtle honey wash at the top — reinforces the
                    // celebration vibe without overwhelming the readable
                    // bone surface.
                    OMShape.card(OMRadius.lg)
                        .fill(
                            LinearGradient(
                                colors: [
                                    OMColor.honey.opacity(0.14),
                                    OMColor.honey.opacity(0.00),
                                ],
                                startPoint: .top,
                                endPoint: .center
                            )
                        )
                }
            )
            .overlay(
                OMShape.card(OMRadius.lg)
                    .stroke(OMColor.honey.opacity(0.55), lineWidth: 1.5)
            )
            // Layered shadows — a tight inner shadow for definition and
            // a wider soft drop to lift the card off the dimmed scrim.
            .shadow(color: .black.opacity(0.18), radius: 4, x: 0, y: 2)
            .shadow(color: .black.opacity(0.30), radius: 36, x: 0, y: 18)
            .padding(24)
        }
    }
}
