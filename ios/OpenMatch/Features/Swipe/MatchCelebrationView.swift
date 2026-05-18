import SwiftUI

// Particle burst behind the match modal. 60 particles arc outward from
// the upper-center anchor, fade by ~1.4s, and a single honey radial pulse
// fires once during the first 0.5s.
//
// Respects accessibilityReduceMotion — when on, renders a single static
// gradient pulse with no particles.
struct MatchCelebrationView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startDate = Date()
    @State private var particles: [Particle] = []

    private let duration: TimeInterval = 1.4
    private let pulseDuration: TimeInterval = 0.5
    private let particleCount = 60

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if reduceMotion {
                    pulse(progress: 0.5, size: proxy.size)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 60, paused: false)) { context in
                        Canvas { ctx, size in
                            let t = context.date.timeIntervalSince(startDate)
                            drawPulse(in: ctx, size: size, t: t)
                            drawParticles(in: ctx, size: size, t: t)
                        }
                    }
                }
            }
            .onAppear {
                if particles.isEmpty {
                    particles = (0..<particleCount).map { _ in Particle.random() }
                }
                startDate = Date()
            }
        }
        .allowsHitTesting(false)
    }

    private func pulse(progress: Double, size: CGSize) -> some View {
        let scale = 0.6 + progress * 0.8
        return RadialGradient(
            colors: [
                OMColor.honey.opacity(0.55 * (1 - progress)),
                OMColor.honey.opacity(0.0)
            ],
            center: .center,
            startRadius: 0,
            endRadius: min(size.width, size.height) * 0.6 * scale
        )
    }

    private func drawPulse(in ctx: GraphicsContext, size: CGSize, t: TimeInterval) {
        let p = min(max(t / pulseDuration, 0), 1)
        if p >= 1 { return }
        let scale = 0.6 + p * 0.8
        let maxR = min(size.width, size.height) * 0.6 * scale
        let center = CGPoint(x: size.width / 2, y: size.height * 0.42)
        var gradient = ctx
        gradient.addFilter(.blur(radius: 8))
        let shading = GraphicsContext.Shading.radialGradient(
            Gradient(colors: [
                OMColor.honey.opacity(0.55 * (1 - p)),
                OMColor.honey.opacity(0.0)
            ]),
            center: center,
            startRadius: 0,
            endRadius: maxR
        )
        let rect = CGRect(x: 0, y: 0, width: size.width, height: size.height)
        ctx.fill(Path(rect), with: shading)
    }

    private func drawParticles(in ctx: GraphicsContext, size: CGSize, t: TimeInterval) {
        if t > duration { return }
        let center = CGPoint(x: size.width / 2, y: size.height * 0.42)
        let gravity: CGFloat = 380
        for p in particles {
            let elapsed = CGFloat(t)
            let vx = CGFloat(cos(p.angle)) * CGFloat(p.speed)
            let vy = CGFloat(sin(p.angle)) * CGFloat(p.speed) - 240
            let x = center.x + vx * elapsed
            let y = center.y + vy * elapsed + 0.5 * gravity * elapsed * elapsed
            let fade = 1 - smoothstep(0.6, duration, t)
            if fade <= 0 { continue }
            let r = CGFloat(p.size)
            let rect = CGRect(x: x - r / 2, y: y - r / 2, width: r, height: r)
            ctx.fill(Path(ellipseIn: rect), with: .color(p.color.opacity(fade)))
        }
    }
}

private struct Particle {
    let angle: Double       // radians; 0 = right, pi/2 = down
    let speed: Double       // points per second
    let size: Double        // diameter in points
    let color: Color

    static func random() -> Particle {
        // Bias the angle upward — particles erupt into the top half of
        // the modal rather than raining sideways.
        let spread = Double.random(in: -1.0...1.0) * 1.0   // wider arc
        let bias: Double = -Double.pi / 2                   // straight up
        let angle = bias + spread
        let speed = Double.random(in: 180...460)
        let size = Double.random(in: 5...11)
        let palette: [Color] = [
            OMColor.terracotta,
            OMColor.honey,
            OMColor.moss,
            OMColor.surfaceElevated,
        ]
        return Particle(
            angle: angle,
            speed: speed,
            size: size,
            color: palette.randomElement() ?? OMColor.honey
        )
    }
}

private func smoothstep(_ edge0: TimeInterval, _ edge1: TimeInterval, _ x: TimeInterval) -> Double {
    let t = max(0, min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}
