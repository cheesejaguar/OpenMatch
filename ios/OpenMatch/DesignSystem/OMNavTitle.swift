import SwiftUI

private struct OMNavTitleModifier: ViewModifier {
    let title: String

    func body(content: Content) -> some View {
        content
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(OMFont.display(20, weight: .semibold, italic: true))
                        .tracking(-0.2)
                        .foregroundStyle(OMColor.plum)
                }
            }
            .toolbarBackground(OMColor.paper, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}

extension View {
    /// Botanic nav title — Fraunces italic moss centered in the bar.
    /// Replaces `.navigationTitle("…")` everywhere so the screen reads
    /// as part of the same brand surface.
    func omNavTitle(_ title: String) -> some View {
        modifier(OMNavTitleModifier(title: title))
    }
}
