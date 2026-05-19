import CoreGraphics
import SwiftUI

/// Radius tokens — use OMShape.* helpers, do not inline RoundedRectangle(cornerRadius:).
/// button → md, card → lg, chip → pill, input → sm
enum OMRadius {
    static let xs: CGFloat = 6
    static let sm: CGFloat = 10
    static let md: CGFloat = 16
    static let lg: CGFloat = 22
    static let pill: CGFloat = 999
}

enum OMShape {
    static func card(_ radius: CGFloat = OMRadius.lg) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }
    static func button(_ radius: CGFloat = OMRadius.md) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }
    static func chip(_ radius: CGFloat = OMRadius.pill) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }
    static func input(_ radius: CGFloat = OMRadius.sm) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }
}
