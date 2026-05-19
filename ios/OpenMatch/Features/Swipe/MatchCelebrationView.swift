import SwiftUI

// Aurora Dawn Phase D — denser, more colorful particle burst.
//
// 120 particles in plum/magenta/marigold/periwinkle/paper, mix of circles
// and four-pointed sparkles. Two-stage emission: the first 40 erupt
// radially from the centre at t=0 with high velocity, the remaining 80
// are emitted at t=0.3s with lower velocity for a "settling rain" effect.
// Total duration 1.8s. The honey/marigold radial pulse is preserved but
// scaled ~30% larger to match the more energetic burst.
//
// Respects accessibilityReduceMotion — when on, renders a single static
// marigold radial pulse with no particle motion.
struct MatchCelebrationView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startDate = Date()
    @State private var particles: [Particle] = []

    private let duration: TimeInterval = 1.8
    private let pulseDuration: TimeInterval = 0.5
    private let secondStageDelay: TimeInterval = 0.30
    private let firstStageCount = 40
    private let secondStageCount = 80
    private var particleCount: Int { firstStageCount + secondStageCount }

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
                    particles = (0..<particleCount).map { i in
                        Particle.random(stage: i < firstStageCount ? .first : .second)
                    }
                }
                startDate = Date()
            }
        }
        .allowsHitTesting(false)
    }

    // MARK: - Pulse

    private func pulse(progress: Double, size: CGSize) -> some View {
        let scale = 0.6 + progress * 0.8
        // 1.3× wider than the prior burst — matches the larger particle
        // field so the radial wash isn't dwarfed by the sparkles.
        return RadialGradient(
            colors: [
                OMColor.marigold.opacity(0.55 * (1 - progress)),
                OMColor.marigold.opacity(0.0)
            ],
            center: .center,
            startRadius: 0,
            endRadius: min(size.width, size.height) * 0.78 * scale
        )
    }

    private func drawPulse(in ctx: GraphicsContext, size: CGSize, t: TimeInterval) {
        let p = min(max(t / pulseDuration, 0), 1)
        if p >= 1 { return }
        let scale = 0.6 + p * 0.8
        // 0.6 × 1.3 ≈ 0.78 — keeps the pulse roughly 30 % larger than V1.
        let maxR = min(size.width, size.height) * 0.78 * scale
        let center = CGPoint(x: size.width / 2, y: size.height * 0.42)
        var gradient = ctx
        gradient.addFilter(.blur(radius: 8))
        let shading = GraphicsContext.Shading.radialGradient(
            Gradient(colors: [
                OMColor.marigold.opacity(0.55 * (1 - p)),
                OMColor.marigold.opacity(0.0)
            ]),
            center: center,
            startRadius: 0,
            endRadius: maxR
        )
        let rect = CGRect(x: 0, y: 0, width: size.width, height: size.height)
        ctx.fill(Path(rect), with: shading)
    }

    // MARK: - Particles

    private func drawParticles(in ctx: GraphicsContext, size: CGSize, t: TimeInterval) {
        if t > duration { return }
        let center = CGPoint(x: size.width / 2, y: size.height * 0.42)
        let gravity: CGFloat = 380
        for p in particles {
            // Stage-2 particles wait until their emission moment.
            let localT = t - p.emissionDelay
            if localT < 0 { continue }
            let elapsed = CGFloat(localT)
            let vx = CGFloat(cos(p.angle)) * CGFloat(p.speed)
            let vy = CGFloat(sin(p.angle)) * CGFloat(p.speed) - 240
            let x = center.x + vx * elapsed
            let y = center.y + vy * elapsed + 0.5 * gravity * elapsed * elapsed

            // Each particle's lifetime starts at its own emission time.
            let lifeRemaining = duration - p.emissionDelay
            let fadeIn: Double = min(1.0, max(0.0, localT / 0.10))
            let fadeOut = 1 - smoothstep(lifeRemaining * 0.5, lifeRemaining, localT)
            let fade = fadeIn * fadeOut
            if fade <= 0 { continue }

            let r = CGFloat(p.size)
            let shading = GraphicsContext.Shading.color(p.color.opacity(fade))

            if p.kind == .circle {
                let rect = CGRect(x: x - r / 2, y: y - r / 2, width: r, height: r)
                ctx.fill(Path(ellipseIn: rect), with: shading)
            } else {
                // Four-pointed sparkle: two crossed diamonds (one vertical,
                // one horizontal). half-extent ~6pt × particle scale.
                let half = max(2, r * 0.55)
                let crossHalf = half * 0.45 // skinnier waist makes it sparkle-shaped
                ctx.fill(sparklePath(at: CGPoint(x: x, y: y), half: half, crossHalf: crossHalf), with: shading)
            }
        }
    }

    /// Builds a four-pointed sparkle (two crossed diamonds) centered at `point`.
    /// `half` is the long-axis half-length; `crossHalf` is the perpendicular
    /// half-width that gives the diamond its waist.
    private func sparklePath(at point: CGPoint, half: CGFloat, crossHalf: CGFloat) -> Path {
        var path = Path()
        // Vertical diamond — tall, narrow.
        path.move(to: CGPoint(x: point.x, y: point.y - half))
        path.addLine(to: CGPoint(x: point.x + crossHalf, y: point.y))
        path.addLine(to: CGPoint(x: point.x, y: point.y + half))
        path.addLine(to: CGPoint(x: point.x - crossHalf, y: point.y))
        path.closeSubpath()
        // Horizontal diamond — wide, narrow vertically.
        path.move(to: CGPoint(x: point.x - half, y: point.y))
        path.addLine(to: CGPoint(x: point.x, y: point.y + crossHalf))
        path.addLine(to: CGPoint(x: point.x + half, y: point.y))
        path.addLine(to: CGPoint(x: point.x, y: point.y - crossHalf))
        path.closeSubpath()
        return path
    }
}

private struct Particle {
    enum Stage { case first, second }
    enum Kind { case circle, sparkle }

    let angle: Double           // radians; 0 = right, pi/2 = down
    let speed: Double           // points per second
    let size: Double            // diameter in points (or sparkle long-axis)
    let color: Color
    let kind: Kind
    let emissionDelay: TimeInterval

    static func random(stage: Stage) -> Particle {
        // Bias the angle upward — particles erupt into the top half of
        // the modal rather than raining sideways. Stage 1 is a fuller
        // radial burst; stage 2 lingers closer to the centre.
        let spread = Double.random(in: -1.0...1.0) * 1.0
        let bias: Double = -Double.pi / 2
        let angle = bias + spread

        let speed: Double
        switch stage {
        case .first:
            // Bigger, faster initial burst.
            speed = Double.random(in: 260...520)
        case .second:
            // Slower "settling rain" pass.
            speed = Double.random(in: 120...260)
        }

        let size = Double.random(in: 5...12)
        let palette: [Color] = [
            OMColor.plum,
            OMColor.magenta,
            OMColor.marigold,
            OMColor.periwinkle,
            OMColor.paper,
        ]
        let color = palette.randomElement() ?? OMColor.magenta
        // ~50/50 split between circles and four-pointed sparkles.
        let kind: Kind = Bool.random() ? .circle : .sparkle
        let emissionDelay: TimeInterval = (stage == .first) ? 0.0 : 0.30
        return Particle(
            angle: angle,
            speed: speed,
            size: size,
            color: color,
            kind: kind,
            emissionDelay: emissionDelay
        )
    }
}

private func smoothstep(_ edge0: TimeInterval, _ edge1: TimeInterval, _ x: TimeInterval) -> Double {
    guard edge1 > edge0 else { return x >= edge1 ? 1 : 0 }
    let t = max(0, min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}
