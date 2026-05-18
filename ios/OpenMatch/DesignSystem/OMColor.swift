import SwiftUI
import UIKit

// Botanic palette — moss + terracotta + honey on bone / espresso.
// Each token has a paired light / dark value that resolves automatically
// via UITraitCollection.userInterfaceStyle. Color is never the only signal:
// every action also carries an icon and label.
enum OMColor {
    // MARK: - Brand
    static let moss = dual(light: 0x2F4F3E, dark: 0x4E7A65)
    static let terracotta = dual(light: 0xC2654B, dark: 0xD88163)
    static let honey = dual(light: 0xD4A340, dark: 0xE6BC5B)
    static let sage = dual(light: 0x9DAE8E, dark: 0x7E9080)
    static let safetyRed = dual(light: 0xB5443A, dark: 0xD26356)

    // MARK: - Surfaces
    static let surface = dual(light: 0xF4EFE6, dark: 0x2A1F1A)
    static let surfaceElevated = dual(light: 0xFBF7EF, dark: 0x352822)
    static let surfaceSunken = dual(light: 0xECE4D4, dark: 0x1F1612)

    // MARK: - Text
    static let ink = dual(light: 0x2A1F1A, dark: 0xF4EFE6)
    static let inkMuted = dual(light: 0x6B5D52, dark: 0xB8AC9F)
    static let inkSubtle = dual(light: 0x8E7F70, dark: 0x8C7F71)
    static let onAccent = dual(light: 0xF4EFE6, dark: 0xF4EFE6)

    // MARK: - Structure
    static let divider = dualAlpha(light: 0x2A1F1A, lightAlpha: 0.10,
                                   dark: 0xF4EFE6, darkAlpha: 0.10)
    static let cardStroke = dualAlpha(light: 0x2A1F1A, lightAlpha: 0.06,
                                      dark: 0xF4EFE6, darkAlpha: 0.08)
    static let scrim = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? uiColor(0x1F1612, alpha: 0.62)
            : uiColor(0x2A1F1A, alpha: 0.55)
    })

    // MARK: - Back-compat aliases (existing call sites keep compiling
    // through the migration; new code should consume the semantic tokens
    // above directly).
    static let like = terracotta
    static let reject = sage
    static let undo = honey
    static let safety = safetyRed
    static let verified = honey
    static let surfaceMuted = surfaceSunken
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
