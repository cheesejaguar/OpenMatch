import SwiftUI

struct OMPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OMFont.body(17, weight: .semibold))
            .foregroundStyle(OMColor.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(OMColor.terracotta, in: OMShape.button())
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.92 : 1.0)
            .animation(.spring(response: 0.22, dampingFraction: 0.85), value: configuration.isPressed)
    }
}

struct OMSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OMFont.body(17, weight: .semibold))
            .foregroundStyle(OMColor.moss)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                OMShape.button()
                    .stroke(OMColor.moss, lineWidth: 1.5)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.85 : 1.0)
            .animation(.spring(response: 0.22, dampingFraction: 0.85), value: configuration.isPressed)
    }
}

struct OMGhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OMFont.body(17, weight: .medium))
            .foregroundStyle(OMColor.moss)
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .opacity(configuration.isPressed ? 0.6 : 1.0)
            .animation(.spring(response: 0.22, dampingFraction: 0.85), value: configuration.isPressed)
    }
}

struct OMDestructiveButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OMFont.body(17, weight: .semibold))
            .foregroundStyle(OMColor.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(OMColor.safetyRed, in: OMShape.button())
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.92 : 1.0)
            .animation(.spring(response: 0.22, dampingFraction: 0.85), value: configuration.isPressed)
    }
}

struct OMCircleActionStyle: ButtonStyle {
    let color: Color
    let size: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: size, height: size)
            .background(
                Circle()
                    .fill(OMColor.surfaceElevated)
                    .omShadow(.floating)
            )
            .overlay(
                Circle()
                    .stroke(color.opacity(0.22), lineWidth: 1)
            )
            .overlay(
                // Inner highlight — top edge picks up a bit of light so the
                // button reads as physical/pressed-clay rather than a flat disc.
                Circle()
                    .trim(from: 0.55, to: 0.95)
                    .stroke(Color.white.opacity(0.10), lineWidth: 1)
                    .blur(radius: 0.5)
            )
            .foregroundStyle(color)
            .scaleEffect(configuration.isPressed ? 0.90 : 1.0)
            .animation(.spring(response: 0.20, dampingFraction: 0.70), value: configuration.isPressed)
    }
}
