import SwiftUI
import UIKit

// Aurora Dawn palette — plum + magenta + marigold + periwinkle on paper / ink.
// A vibrant, dopamine-forward palette tuned for a dating app: plum (creativity,
// romantic anticipation) as the hero, magenta (energy without Tinder-red
// baggage) for spark moments, marigold (sunrise, joy) for celebration, and
// periwinkle (sky-after-rain) for calm. Each token has a paired light / dark
// value that resolves automatically via UITraitCollection.userInterfaceStyle.
// Color is never the only signal: every action also carries an icon and label.
enum OMColor {
    // MARK: - Brand (Aurora Dawn)
    static let plum = dual(light: 0x5B2B6E, dark: 0x8E4DA8)
    static let magenta = dual(light: 0xD88FA8, dark: 0xE0A4B8)
    static let marigold = dual(light: 0xFFB347, dark: 0xFFC76A)
    static let periwinkle = dual(light: 0xA6B4FF, dark: 0x7C8EE6)
    static let cinnabar = dual(light: 0xD43A3A, dark: 0xE66363)
    static let mauve = dual(light: 0xB8A8C9, dark: 0x8A7AA0)

    // MARK: - Surfaces
    static let paper = dual(light: 0xFAF6F2, dark: 0x1A0E2A)
    static let paperElevated = dual(light: 0xFFFFFF, dark: 0x2B1942)
    static let paperSunken = dual(light: 0xF1ECE5, dark: 0x13081E)

    // MARK: - Text
    static let ink = dual(light: 0x1A0E2A, dark: 0xFAF6F2)
    static let inkMuted = dual(light: 0x5E4C75, dark: 0xC0B3D6)
    static let inkSubtle = dual(light: 0x7C6A95, dark: 0x9F90B8)
    static let onAccent = dual(light: 0xFAF6F2, dark: 0xFAF6F2)

    // MARK: - Structure
    static let divider = dualAlpha(light: 0x1A0E2A, lightAlpha: 0.10,
                                   dark: 0xFAF6F2, darkAlpha: 0.10)
    static let cardStroke = dualAlpha(light: 0x1A0E2A, lightAlpha: 0.06,
                                      dark: 0xFAF6F2, darkAlpha: 0.08)
    static let scrim = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? uiColor(0x13081E, alpha: 0.70)
            : uiColor(0x1A0E2A, alpha: 0.55)
    })

    // MARK: - Back-compat aliases (Botanic-era token names)
    // Keep existing call sites compiling while Phase F sweeps them. New code
    // should consume the Aurora Dawn semantic tokens above directly.
    static let moss = plum
    static let terracotta = magenta
    static let honey = marigold
    static let sage = periwinkle
    static let safetyRed = cinnabar
    static let like = magenta
    static let reject = mauve
    static let undo = marigold
    static let safety = cinnabar
    static let verified = marigold
    static let surface = paper
    static let surfaceElevated = paperElevated
    static let surfaceSunken = paperSunken
    static let surfaceMuted = paperSunken
    static let bone = paper
    static let espresso = ink
    static let textPrimary = ink
    static let textSecondary = inkMuted

    // MARK: - Helpers
    private static func dual(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { trait in
            trait.userInterfaceStyle == .dark ? uiColor(dark) : uiColor(light)
        })
    }

    private static func dualAlpha(light: UInt32, lightAlpha: CGFloat,
                                  dark: UInt32, darkAlpha: CGFloat) -> Color {
        Color(uiColor: UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? uiColor(dark, alpha: darkAlpha)
                : uiColor(light, alpha: lightAlpha)
        })
    }
}

private func uiColor(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
    UIColor(
        red: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: alpha
    )
}
