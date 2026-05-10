import SwiftUI

struct OMCircleActionStyle: ButtonStyle {
    let color: Color
    let size: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: size, height: size)
            .background(
                Circle()
                    .fill(.background)
                    .shadow(
                        color: .black.opacity(0.12),
                        radius: 8,
                        x: 0, y: 4
                    )
            )
            .overlay(
                Circle().stroke(color.opacity(0.18), lineWidth: 1)
            )
            .foregroundStyle(color)
            .scaleEffect(configuration.isPressed ? 0.92 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

struct OMPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(OMColor.like, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1.0)
    }
}
