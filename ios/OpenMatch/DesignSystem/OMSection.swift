import SwiftUI

// Section wrapper: Fraunces-italic moss header, optional footer caption,
// and a card surface that groups its rows on `surfaceElevated`. Hairline
// dividers go between consecutive rows automatically via OMSectionDivider.
struct OMSection<Content: View>: View {
    let title: String?
    let footer: String?
    @ViewBuilder let content: () -> Content

    init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: OMSpacing.sm) {
            if let title {
                Text(title.uppercased())
                    .font(OMFont.display(12, weight: .semibold, italic: true))
                    .tracking(1.4)
                    .foregroundStyle(OMColor.plum)
                    .padding(.leading, OMSpacing.sm)
            }
            VStack(spacing: 0) {
                content()
            }
            .background(
                OMShape.card(OMRadius.lg)
                    .fill(OMColor.surfaceElevated)
            )
            .overlay(
                OMShape.card(OMRadius.lg)
                    .stroke(OMColor.cardStroke, lineWidth: 1)
            )
            .omShadow(.card)
            if let footer {
                Text(footer)
                    .font(OMFont.caption)
                    .foregroundStyle(OMColor.inkMuted)
                    .padding(.horizontal, OMSpacing.sm)
            }
        }
    }
}

// Use between OMRows inside an OMSection. Renders only between rows,
// not at the section edges, so callers don't have to special-case.
struct OMSectionDivider: View {
    var body: some View {
        Rectangle()
            .fill(OMColor.divider)
            .frame(height: 1)
            .padding(.leading, OMSpacing.lg)
    }
}
