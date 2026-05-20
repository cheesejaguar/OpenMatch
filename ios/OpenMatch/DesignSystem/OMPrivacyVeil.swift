import SwiftUI

// SEV-M3 — App-switcher privacy veil.
//
// iOS captures a screenshot of the current scene when the app moves to
// the app-switcher (technically during the `.inactive` transition, before
// `.background`). For a dating app the last visible screen is likely
// chat content, match photos, or the Likes list — all of which would
// land unencrypted in `~/Library/Caches/Snapshots/<bundle-id>/`.
//
// `OMPrivacyVeil` is a full-screen opaque overlay we slot in *above*
// every other content view whenever `scenePhase != .active`. Because
// SwiftUI evaluates `body` synchronously on the main thread, the veil is
// in the view hierarchy by the time the OS takes its snapshot.
//
// The veil is intentionally simple: paper surface + the OpenMatch mark.
// No user content, no text, no environment-dependent colour transitions
// that could briefly render through.
struct OMPrivacyVeil: View {
    var body: some View {
        ZStack {
            OMColor.paperElevated
                .ignoresSafeArea()
            // Same abstract heart used on the launch screen / welcome.
            // Two facing leaves form the heart silhouette; deliberately
            // small so it reads as a neutral splash, not a teaser of any
            // particular feature.
            ZStack {
                Circle()
                    .fill(OMColor.paper)
                    .frame(width: 96, height: 96)
                Image(systemName: "leaf.fill")
                    .font(.system(size: 38, weight: .bold))
                    .foregroundStyle(OMColor.magenta)
                    .rotationEffect(.degrees(-30))
                    .offset(x: -8, y: 0)
                Image(systemName: "leaf.fill")
                    .font(.system(size: 38, weight: .bold))
                    .foregroundStyle(OMColor.plum)
                    .rotationEffect(.degrees(150))
                    .offset(x: 8, y: 0)
            }
        }
        // Block any hit-testing while the veil is showing so a stray
        // background tap doesn't drive a hidden control.
        .contentShape(Rectangle())
        .accessibilityHidden(true)
    }

    // Pure-function visibility predicate used by RootView and exercised
    // directly in unit tests. The veil is drawn for every non-active
    // phase — `.inactive` is the OS snapshot phase, and `.background`
    // covers belt-and-suspenders for cases where the snapshot is
    // re-taken on resume.
    static func isVisible(for phase: ScenePhase) -> Bool {
        switch phase {
        case .active: return false
        case .inactive, .background: return true
        @unknown default: return true
        }
    }
}

#Preview {
    OMPrivacyVeil()
}
