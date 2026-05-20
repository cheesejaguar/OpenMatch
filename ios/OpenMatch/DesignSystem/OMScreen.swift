import SwiftUI

// Root container for every screen post-overhaul. Paints Bone (or Espresso
// in dark mode) edge-to-edge, hides the system grouped-list background
// that SwiftUI's List/Form would otherwise paint, and stacks the actual
// content above it. Use as the outermost view inside NavigationStack.
struct OMScreen<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            OMColor.paper.ignoresSafeArea()
            content()
        }
        .scrollContentBackground(.hidden)
    }
}
