import SwiftUI

// Aurora Dawn Phase D — dopamine match moment.
//
// Visual contract:
//   • Plum-ink scrim (not espresso) + ultraThinMaterial.
//   • paperElevated card with magenta stroke + ink drop shadow.
//   • "It's a match" rendered in OMFont.hero (Fraunces Black Italic 56pt)
//     in OMColor.magenta. Each character springs in individually with a
//     60 ms stagger for a dopamine reveal.
//   • Subtitle "You and <name>" in bodyLarge medium / ink.
//   • Primary CTA: magenta fill, paper text — "Send a message".
//   • Secondary CTA: plum-stroked ghost — "Keep swiping".
//
// Accessibility: respects accessibilityReduceMotion (no stagger animation),
// and exposes the full "It's a match" string to VoiceOver via an
// accessibilityLabel on the title container so screen readers + UI tests
// still see a single coherent label rather than ten loose glyphs.
struct MatchOverlayView: View {
    let card: ProfileCardModel
    let onDismiss: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var titleAppeared = false

    private static let titleString = "It's a match"
    private static let titleCharacters: [Character] = Array("It's a match")

    var body: some View {
        ZStack {
            // 1) Plum-ink scrim. Two layers — solid tint at 70 % over an
            // ultraThinMaterial blur — give a vivid, contrast-y backdrop
            // without the muddy brown the old espresso scrim produced.
            ZStack {
                OMColor.ink.opacity(0.70)
                Rectangle().fill(.ultraThinMaterial)
            }
            .ignoresSafeArea()

            // 2) Particle burst lives behind the card so the burst reads as
            // "explosion behind the matched pair", not in front of the copy.
            MatchCelebrationView()
                .ignoresSafeArea()

            // 3) The card itself.
            VStack(spacing: 18) {
                titleView
                    .padding(.top, 4)

                Text("You and \(card.displayName)")
                    .font(OMFont.body(17, weight: .medium))
                    .foregroundStyle(OMColor.ink)
                    .multilineTextAlignment(.center)

                VStack(spacing: 12) {
                    Button(action: onDismiss) {
                        Text("Send a message")
                            .font(OMFont.body(17, weight: .semibold))
                            .foregroundStyle(OMColor.paper)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(OMColor.magenta, in: OMShape.button())
                    }
                    .buttonStyle(.plain)

                    Button(action: onDismiss) {
                        Text("Keep swiping")
                            .font(OMFont.body(17, weight: .semibold))
                            .foregroundStyle(OMColor.plum)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(
                                OMShape.button()
                                    .stroke(OMColor.plum, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 8)
            }
            .padding(30)
            .background(
                OMShape.card(OMRadius.lg)
                    .fill(OMColor.paperElevated)
            )
            .overlay(
                OMShape.card(OMRadius.lg)
                    .stroke(OMColor.magenta.opacity(0.60), lineWidth: 2)
            )
            .shadow(color: OMColor.ink.opacity(0.30), radius: 40, x: 0, y: 20)
            .padding(24)
        }
        .onAppear {
            // Brief delay so the modal can finish its presentation
            // transition before the per-character spring fires.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
                titleAppeared = true
            }
            // IOS-9 — ask for push permission only after the user has seen
            // the value (their first match). Fire-and-forget.
            Task {
                await Analytics.shared.record("match.shown")
                _ = await PushService.shared.requestAuthorization()
            }
        }
    }

    // MARK: - Title

    // Per-character spring reveal. Each glyph scales + fades in from
    // (scale 0, opacity 0) → (1, 1) with response 0.4 / damping 0.6,
    // staggered by 60 ms. VoiceOver sees the full string via the
    // accessibilityLabel on the container, not the individual glyphs.
    private var titleView: some View {
        HStack(spacing: 0) {
            ForEach(Array(Self.titleCharacters.enumerated()), id: \.offset) { index, ch in
                Text(String(ch))
                    .font(OMFont.hero)
                    .foregroundStyle(OMColor.magenta)
                    .scaleEffect(shouldShow ? 1 : 0)
                    .opacity(shouldShow ? 1 : 0)
                    .animation(
                        reduceMotion
                            ? nil
                            : .spring(response: 0.4, dampingFraction: 0.6)
                                .delay(0.060 * Double(index)),
                        value: titleAppeared
                    )
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Self.titleString)
    }

    private var shouldShow: Bool {
        // Reduce-motion users see the title fully revealed immediately —
        // no scale/opacity animation, no stagger.
        reduceMotion || titleAppeared
    }
}
