import SwiftUI
import UIKit

// PERF-I7 — Device-class gating for the particle burst.
//
// `MatchCelebrationConfig` parameterizes the burst by device capability:
//   - `.full`    — 120 particles, blur on pulse, 1.8s (A15+, nominal thermal)
//   - `.reduced` — 60 particles, no blur, 1.2s (A14, or `.fair` thermal)
//   - `.skip`    — no burst at all (`.serious` / `.critical` thermal)
//
// `MatchCelebrationConfig.current()` reads `ProcessInfo.thermalState`
// and `UIDevice.current.modelIdentifier` to pick a tier. The result is
// captured once when the overlay appears — we don't reactively
// downgrade mid-burst (which would look glitchy).
struct MatchCelebrationConfig {
    enum Tier { case full, reduced, skip }

    let tier: Tier
    let particleCount: Int
    let firstStageCount: Int
    let secondStageCount: Int
    let duration: TimeInterval
    let applyBlur: Bool

    static let full = MatchCelebrationConfig(
        tier: .full,
        particleCount: 120,
        firstStageCount: 40,
        secondStageCount: 80,
        duration: 1.8,
        applyBlur: true
    )

    static let reduced = MatchCelebrationConfig(
        tier: .reduced,
        particleCount: 60,
        firstStageCount: 20,
        secondStageCount: 40,
        duration: 1.2,
        applyBlur: false
    )

    static let skip = MatchCelebrationConfig(
        tier: .skip,
        particleCount: 0,
        firstStageCount: 0,
        secondStageCount: 0,
        duration: 0,
        applyBlur: false
    )

    // Pick a tier based on thermal state + device generation.
    // Thermal state takes precedence — a hot device on any chip should
    // skip the burst. Below `.serious`, A14-and-older devices step down
    // to `.reduced`.
    static func current() -> MatchCelebrationConfig {
        switch ProcessInfo.processInfo.thermalState {
        case .serious, .critical:
            return .skip
        case .fair:
            return .reduced
        case .nominal:
            return isPreA15Device() ? .reduced : .full
        @unknown default:
            return .reduced
        }
    }

    // Identify A14 (iPhone 12/12 mini/12 Pro/12 Pro Max + iPhone SE 3rd gen
    // uses A15, so this is purely the iPhone 12 family on the iPhone side)
    // and older as "step-down" devices. Anything newer (A15 / M-series)
    // and the simulator both get the full burst. The simulator runs on
    // the host's GPU and is essentially uncapped.
    private static func isPreA15Device() -> Bool {
        let id = modelIdentifier()
        #if targetEnvironment(simulator)
        return false
        #else
        // iPhone 12 family: iPhone13,1 … iPhone13,4.
        // Anything older is iPhone12,x or below. We treat iPhone13,*
        // and below as pre-A15.
        if id.hasPrefix("iPhone") {
            let stripped = id.dropFirst("iPhone".count)
            if let major = stripped.split(separator: ",").first.flatMap({ Int($0) }) {
                return major <= 13
            }
        }
        // iPad — assume full tier; the iPad lineup runs cooler.
        return false
        #endif
    }

    private static func modelIdentifier() -> String {
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? "simulator"
        #else
        var systemInfo = utsname()
        uname(&systemInfo)
        let mirror = Mirror(reflecting: systemInfo.machine)
        return mirror.children.reduce(into: "") { acc, element in
            guard let value = element.value as? Int8, value != 0 else { return }
            acc.append(Character(UnicodeScalar(UInt8(value))))
        }
        #endif
    }
}

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

    // PERF-I7 — Device-class gating. The full burst stays full on A15+;
    // older devices step down. Captured at view-creation time so the
    // burst doesn't visibly degrade mid-flight.
    let config: MatchCelebrationConfig

    init(config: MatchCelebrationConfig = .current()) {
        self.config = config
    }

    private let pulseDuration: TimeInterval = 0.5
    private let secondStageDelay: TimeInterval = 0.30

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if reduceMotion || config.tier == .skip {
                    // No motion: a single static radial pulse keeps the
                    // moment celebratory without animation.
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
                if particles.isEmpty && config.tier != .skip {
                    particles = (0..<config.particleCount).map { i in
                        Particle.random(stage: i < config.firstStageCount ? .first : .second)
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
        // PERF-I7 — `Canvas` filters are CPU-side. Skip on the reduced
        // tier; the radial gradient still reads as a pulse without it.
        if config.applyBlur {
            gradient.addFilter(.blur(radius: 8))
        }
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
        if t > config.duration { return }
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
            let lifeRemaining = config.duration - p.emissionDelay
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
