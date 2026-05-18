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
                    .foregroundStyle(OMColor.honey)
                Text("You and \(card.displayName) liked each other.")
                    .font(OMFont.callout)
                    .foregroundStyle(OMColor.surface.opacity(0.92))
                    .multilineTextAlignment(.center)
                VStack(spacing: 10) {
                    Button("Send a message", action: onDismiss)
                        .buttonStyle(OMPrimaryButtonStyle())
                    Button("Keep swiping", action: onDismiss)
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.surface.opacity(0.85))
                        .padding(.top, 4)
                }
                .padding(.top, 8)
            }
            .padding(30)
            .background(
                OMShape.card(OMRadius.lg)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                OMShape.card(OMRadius.lg)
                    .stroke(OMColor.honey.opacity(0.30), lineWidth: 1)
            )
            .padding(24)
        }
    }
}
