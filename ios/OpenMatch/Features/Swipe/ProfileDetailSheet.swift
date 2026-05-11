import SwiftUI

struct ProfileDetailSheet: View {
    let card: ProfileCardModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(card.displayName)
                        .font(.largeTitle.bold())
                    Text(card.distanceText)
                        .foregroundStyle(.secondary)

                    if !card.bio.isEmpty {
                        Text(card.bio).font(.body)
                    }

                    if !card.interests.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Interests").font(.headline)
                            FlowLayout(spacing: 6) {
                                ForEach(card.interests, id: \.self) { tag in
                                    Text(tag)
                                        .font(.caption)
                                        .padding(.horizontal, 10).padding(.vertical, 6)
                                        .background(OMColor.surfaceMuted, in: Capsule())
                                }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Label("Why am I seeing this profile?", systemImage: "doc.text.magnifyingglass")
                            .font(.headline)
                            .foregroundStyle(OMColor.like)
                        Text(card.explanation.summary.isEmpty
                             ? "OpenMatch matched this profile to your transparent filters."
                             : card.explanation.summary)
                            .font(.callout)
                        NavigationLink("View the full algorithm") {
                            AlgorithmView()
                        }
                        .font(.callout.weight(.semibold))
                    }
                    .padding(14)
                    .background(OMColor.surfaceMuted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                    SafetyActions(profileId: card.profileId, userId: card.userId) {
                        dismiss()
                    }
                    .padding(.top, 8)
                }
                .padding(20)
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var size = CGSize.zero
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxWidth {
                size.width = max(size.width, x - spacing)
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
        size.width = max(size.width, x - spacing)
        size.height = y + rowHeight
        return size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxWidth = bounds.width
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.minX + maxWidth {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}
