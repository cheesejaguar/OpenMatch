import SwiftUI

// Grid-mode alternative to SwipeDeckView, gated by
// `PlatformConfig.shared.enableSwipeDeck == false`. The mentorship
// variant flips that toggle so a stack of card swipes (designed for
// dating) gives way to a browse-style grid that matches the product
// expectation for finding a mentor.
//
// This is intentionally lean — it reuses SwipeDeckViewModel for data
// loading and tap-to-detail / express-interest actions. The full grid
// experience (filters, sort, profile detail enrichment) is left as a
// follow-up; this view exists to make `enableSwipeDeck` observable
// today.
struct DiscoveryGridView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = SwipeDeckViewModel()

    private let columns = [
        GridItem(.adaptive(minimum: 150), spacing: 12)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                if vm.isLoading && vm.cards.isEmpty {
                    ProgressView().controlSize(.large).padding(40)
                } else if vm.cards.isEmpty {
                    Text("No matches available yet.")
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)
                        .padding(40)
                } else {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(vm.cards) { card in
                            GridCard(card: card)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(PlatformConfig.shared.appName)
            .navigationBarTitleDisplayMode(.inline)
            .task {
                vm.api = api
                if vm.cards.isEmpty {
                    await vm.load()
                }
            }
        }
    }
}

private struct GridCard: View {
    let card: ProfileCardModel
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 12)
                .fill(OMColor.surfaceElevated)
                .frame(height: 160)
                .overlay(
                    Text(String(card.displayName.prefix(1)))
                        .font(OMFont.display(48, weight: .bold))
                        .foregroundStyle(OMColor.plum.opacity(0.6))
                )
            Text(card.displayName)
                .font(OMFont.body(15, weight: .semibold))
                .foregroundStyle(OMColor.ink)
                .lineLimit(1)
        }
    }
}
