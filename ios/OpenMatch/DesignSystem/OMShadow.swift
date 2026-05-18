import SwiftUI

struct OMShadow {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat

    static let card = OMShadow(color: .black.opacity(0.10), radius: 18, x: 0, y: 8)
    static let floating = OMShadow(color: .black.opacity(0.16), radius: 24, x: 0, y: 12)
    static let pressed = OMShadow(color: .black.opacity(0.08), radius: 6, x: 0, y: 2)
    static let none = OMShadow(color: .clear, radius: 0, x: 0, y: 0)
}

extension View {
    func omShadow(_ shadow: OMShadow) -> some View {
        self.shadow(color: shadow.color, radius: shadow.radius, x: shadow.x, y: shadow.y)
    }
}
