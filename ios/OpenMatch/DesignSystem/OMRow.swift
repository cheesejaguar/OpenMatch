import SwiftUI

// Generic Botanic row cell. Used inside OMSection or standalone. Acts
// as a button when `action` is non-nil, otherwise a plain container.
// Use `chevron: true` for NavigationLink-style affordance.
struct OMRow<Trailing: View>: View {
    let label: String
    var caption: String? = nil
    var systemImage: String? = nil
    var iconTint: Color = OMColor.moss
    var chevron: Bool = false
    var action: (() -> Void)? = nil
    @ViewBuilder var trailing: () -> Trailing

    init(
        _ label: String,
        caption: String? = nil,
        systemImage: String? = nil,
        iconTint: Color = OMColor.moss,
        chevron: Bool = false,
        action: (() -> Void)? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }
    ) {
        self.label = label
        self.caption = caption
        self.systemImage = systemImage
        self.iconTint = iconTint
        self.chevron = chevron
        self.action = action
        self.trailing = trailing
    }

    var body: some View {
        if let action {
            Button(action: action) { content }
                .buttonStyle(.plain)
        } else {
            content
        }
    }

    private var content: some View {
        HStack(spacing: OMSpacing.md) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(iconTint)
                    .frame(width: 24)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(OMFont.body(16, weight: .medium))
                    .foregroundStyle(OMColor.ink)
                if let caption {
                    Text(caption)
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                }
            }
            Spacer(minLength: 8)
            trailing()
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OMColor.inkMuted)
            }
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}
