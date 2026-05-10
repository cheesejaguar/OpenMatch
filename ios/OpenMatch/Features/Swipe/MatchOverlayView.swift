import SwiftUI

struct MatchOverlayView: View {
    let card: ProfileCardModel
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.75).ignoresSafeArea()
            VStack(spacing: 18) {
                Image(systemName: "sparkles")
                    .font(.system(size: 56))
                    .foregroundStyle(OMColor.like)
                Text("It's a match!")
                    .font(.largeTitle.bold())
                    .foregroundStyle(.white)
                Text("You and \(card.displayName) liked each other.")
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.85))
                    .multilineTextAlignment(.center)
                VStack(spacing: 10) {
                    Button("Send a message", action: onDismiss)
                        .buttonStyle(OMPrimaryButtonStyle())
                    Button("Keep swiping", action: onDismiss)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.top, 4)
                }
                .padding(.top, 8)
            }
            .padding(30)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(24)
        }
    }
}
