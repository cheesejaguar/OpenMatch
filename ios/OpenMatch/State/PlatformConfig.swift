import Foundation

// Platform-config bridge for iOS. The backend's `openmatch.config.ts`
// drives most behaviour, but a handful of toggles need to be read by
// the client too (we can't ship UI for the swipe deck AND the grid
// view at the same time without bloating the binary or making the deck
// flicker on first load).
//
// Forks bake their config snapshot into Info.plist at build time. The
// keys here mirror a subset of `openmatch.config.ts`; if a key is
// missing, we fall back to the dating variant defaults so a stock
// build keeps working unchanged.

enum PlatformVariant: String {
    case dating
    case mentorship
    case roommates
    case sports
    case custom
}

struct PlatformConfig {
    let variant: PlatformVariant
    let appName: String
    let matchVerb: String
    let swipeRightVerb: String
    let enableSwipeDeck: Bool
    let enableMatchOverlay: Bool
    let minPhotos: Int
    let maxPhotos: Int
    let requirePhotos: Bool

    static let shared: PlatformConfig = loadFromBundle()

    private static func loadFromBundle() -> PlatformConfig {
        let info = Bundle.main.infoDictionary
        let variantString = info?["OMConfigVariant"] as? String ?? "dating"
        let variant = PlatformVariant(rawValue: variantString) ?? .dating
        return PlatformConfig(
            variant: variant,
            appName: info?["OMConfigAppName"] as? String ?? "OpenMatch",
            matchVerb: info?["OMConfigMatchVerb"] as? String ?? "matched",
            swipeRightVerb: info?["OMConfigSwipeRightVerb"] as? String ?? "like",
            enableSwipeDeck: info?["OMConfigEnableSwipeDeck"] as? Bool ?? true,
            enableMatchOverlay: info?["OMConfigEnableMatchOverlay"] as? Bool ?? true,
            minPhotos: (info?["OMConfigMinPhotos"] as? NSNumber)?.intValue ?? 2,
            maxPhotos: (info?["OMConfigMaxPhotos"] as? NSNumber)?.intValue ?? 9,
            requirePhotos: info?["OMConfigRequirePhotos"] as? Bool ?? true
        )
    }
}
