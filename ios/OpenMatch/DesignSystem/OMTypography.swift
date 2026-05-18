import SwiftUI
import UIKit

// Custom typography exposed as Fraunces (display) and Geist (body).
// Postscript names match the .ttf files in OpenMatch/Resources/Fonts/.
// When the fonts haven't been registered yet (previews, snapshot tests)
// SwiftUI silently falls back to the system font.
enum OMFont {
    enum DisplayWeight {
        case regular, semibold, bold
        // PostScript names from the Fraunces 9pt static cuts shipped in
        // Resources/Fonts. Extracted via the OS/2 + name table; do not
        // edit without re-verifying with the helper in
        // OMFont.debugDumpAvailableFamilies().
        fileprivate func postscript(italic: Bool) -> String {
            switch (self, italic) {
            case (.regular, false): return "Fraunces9pt-Regular"
            case (.regular, true): return "Fraunces9pt-Italic"
            case (.semibold, false): return "Fraunces9pt-SemiBold"
            case (.semibold, true): return "Fraunces9pt-SemiBoldItalic"
            case (.bold, false): return "Fraunces9pt-Bold"
            case (.bold, true): return "Fraunces9pt-BoldItalic"
            }
        }
    }

    enum BodyWeight {
        case regular, medium, semibold, bold
        fileprivate var postscript: String {
            switch self {
            case .regular: return "Geist-Regular"
            case .medium: return "Geist-Medium"
            case .semibold: return "Geist-SemiBold"
            case .bold: return "Geist-Bold"
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
    static var largeTitle: Font { display(34, weight: .bold) }
    static var largeTitleItalic: Font { display(34, weight: .bold, italic: true) }
    static var title: Font { display(28, weight: .semibold) }
    static var headline: Font { body(17, weight: .semibold) }
    static var subhead: Font { display(22, weight: .semibold) }
    static var bodyRegular: Font { body(17, weight: .regular) }
    static var bodyMedium: Font { body(17, weight: .medium) }
    static var callout: Font { body(15, weight: .regular) }
    static var calloutMedium: Font { body(15, weight: .medium) }
    static var caption: Font { body(13, weight: .regular) }
    static var captionBold: Font { body(13, weight: .semibold) }

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
