import SwiftUI
import UIKit

// Custom typography exposed as Fraunces (display) and Geist (body).
// Postscript names match the .ttf files in OpenMatch/Resources/Fonts/.
// When the fonts haven't been registered yet (previews, snapshot tests)
// SwiftUI silently falls back to the system font.
enum OMFont {
    enum DisplayWeight {
        case light, regular, medium, semibold, bold, black
        // PostScript names from the Fraunces 9pt static cuts shipped in
        // Resources/Fonts. Extracted via the OS/2 + name table; do not
        // edit without re-verifying with the helper in
        // OMFont.debugDumpAvailableFamilies().
        //
        // Italic cuts shipped in the 9pt static range: Regular, SemiBold,
        // Bold, Black. Light + Medium italic do not exist as static
        // cuts — we fall back gracefully (Light → Regular italic,
        // Medium → SemiBold italic) so call sites that ask for an
        // italic variant still produce a sensible result.
        fileprivate func postscript(italic: Bool) -> String {
            switch (self, italic) {
            // PERF-I12 — Fraunces9pt-Light.ttf is no longer bundled (no
            // call sites). Map .light to Regular so any call that
            // re-introduces the request renders a sensible weight
            // rather than falling back to the system font.
            case (.light, false): return "Fraunces9pt-Regular"
            case (.light, true): return "Fraunces9pt-Italic"
            case (.regular, false): return "Fraunces9pt-Regular"
            case (.regular, true): return "Fraunces9pt-Italic"
            // Medium isn't shipped in the 9pt static cuts either; fall
            // back to SemiBold so the call site still gets a heavier
            // optical weight than regular.
            case (.medium, false): return "Fraunces9pt-SemiBold"
            case (.medium, true): return "Fraunces9pt-SemiBoldItalic"
            case (.semibold, false): return "Fraunces9pt-SemiBold"
            case (.semibold, true): return "Fraunces9pt-SemiBoldItalic"
            case (.bold, false): return "Fraunces9pt-Bold"
            case (.bold, true): return "Fraunces9pt-BoldItalic"
            case (.black, false): return "Fraunces9pt-Black"
            case (.black, true): return "Fraunces9pt-BlackItalic"
            }
        }
    }

    enum BodyWeight {
        case light, regular, medium, semibold, bold, black
        fileprivate var postscript: String {
            switch self {
            // PERF-I12 — Geist-Light.ttf removed; fall back to Regular.
            case .light: return "Geist-Regular"
            case .regular: return "Geist-Regular"
            case .medium: return "Geist-Medium"
            case .semibold: return "Geist-SemiBold"
            case .bold: return "Geist-Bold"
            case .black: return "Geist-Black"
            }
        }
    }

    static func display(_ size: CGFloat, weight: DisplayWeight = .semibold, italic: Bool = false) -> Font {
        Font.custom(weight.postscript(italic: italic), size: size)
    }

    static func body(_ size: CGFloat, weight: BodyWeight = .regular) -> Font {
        Font.custom(weight.postscript, size: size)
    }

    // Typed scale. Display sizes default to Fraunces; body sizes to Geist.
    //
    // Aurora Dawn (Phase B) adds two new tokens at the extremes of the
    // scale: `hero` (the match-overlay headline) and `microcaption`
    // (uppercase metadata, badges, dense table headers). Existing
    // tokens are preserved so the rest of the codebase keeps compiling
    // until the Phase F sweep adopts the new tokens.
    static var hero: Font { OMFont.display(56, weight: .black, italic: true) }
    static var displayLarge: Font { OMFont.display(40, weight: .black, italic: true) }
    static var largeTitle: Font { OMFont.display(34, weight: .bold) }
    static var largeTitleItalic: Font { OMFont.display(34, weight: .bold, italic: true) }
    static var title: Font { OMFont.display(28, weight: .semibold) }
    static var headline: Font { body(17, weight: .semibold) }
    static var subhead: Font { OMFont.display(22, weight: .semibold) }
    static var bodyRegular: Font { body(17, weight: .regular) }
    static var bodyMedium: Font { body(17, weight: .medium) }
    static var bodyLarge: Font { body(17, weight: .regular) }
    static var callout: Font { body(15, weight: .regular) }
    static var calloutMedium: Font { body(15, weight: .medium) }
    static var caption: Font { body(13, weight: .regular) }
    static var captionBold: Font { body(13, weight: .semibold) }
    static var microcaption: Font { body(11, weight: .semibold) }

    // Surfaces missing-font issues immediately on first launch in DEBUG.
    static func debugDumpAvailableFamilies() {
        #if DEBUG
        let fraunces9 = UIFont.fontNames(forFamilyName: "Fraunces 9pt")
        let fraunces = UIFont.fontNames(forFamilyName: "Fraunces")
        let geist = UIFont.fontNames(forFamilyName: "Geist")
        print("[OMFont] Fraunces 9pt variants: \(fraunces9)")
        print("[OMFont] Fraunces variants: \(fraunces)")
        print("[OMFont] Geist variants: \(geist)")
        if fraunces9.isEmpty && fraunces.isEmpty {
            print("[OMFont] WARNING — Fraunces missing. Check Info.plist UIAppFonts and target membership of Resources/Fonts/*.ttf")
        }
        if geist.isEmpty {
            print("[OMFont] WARNING — Geist missing.")
        }
        #endif
    }
}
