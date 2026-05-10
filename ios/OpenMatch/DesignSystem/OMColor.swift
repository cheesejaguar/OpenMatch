import SwiftUI

// Semantic color tokens for OpenMatch.
// Color is never the only signal — every action has an icon and label.
enum OMColor {
    static let like     = Color(red: 0.93, green: 0.36, blue: 0.45)
    static let reject   = Color(red: 0.42, green: 0.46, blue: 0.55)
    static let undo     = Color(red: 0.95, green: 0.70, blue: 0.32)
    static let safety   = Color(red: 0.86, green: 0.30, blue: 0.27)
    static let verified = Color(red: 0.24, green: 0.55, blue: 0.85)
    static let surface  = Color(.systemBackground)
    static let surfaceMuted = Color(.secondarySystemBackground)
    static let textPrimary = Color(.label)
    static let textSecondary = Color(.secondaryLabel)
}
