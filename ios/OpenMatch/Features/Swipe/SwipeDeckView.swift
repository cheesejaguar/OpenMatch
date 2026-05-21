import SwiftUI

struct SwipeDeckView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm: SwipeDeckViewModel
    @State private var dragOffset: CGSize = .zero
    @State private var detailCard: ProfileCardModel?
    @State private var hasCrossedThreshold = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let likeThreshold: CGFloat = 110
    // Earlier haptic at the "intent" boundary — gives the user feedback
    // that the swipe is registering before the final commit.
    private let intentThreshold: CGFloat = 80

    init(viewModel: SwipeDeckViewModel? = nil) {
        if let vm = viewModel {
            _vm = StateObject(wrappedValue: vm)
        } else {
            _vm = StateObject(wrappedValue: SwipeDeckViewModel())
        }
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                ZStack {
                    if vm.isLoading && vm.cards.isEmpty {
                        ProgressView().controlSize(.large)
                    } else if vm.cards.isEmpty {
                        emptyState
                    } else {
                        cardStack(in: geo.size)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            .navigationTitle("OpenMatch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink {
                        LookingForView()
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .accessibilityLabel("Filters")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        AlgorithmView()
                    } label: {
                        Image(systemName: "doc.text.magnifyingglass")
                    }
                    .accessibilityLabel("Why these profiles?")
                }
            }
            .task {
                // Inject the shared API client once it's env-available.
                vm.api = api
                vm.cards.removeAll(keepingCapacity: true)
                await vm.load()
            }
            .sheet(item: $detailCard) { card in
                ProfileDetailSheet(card: card)
            }
            .overlay {
                if let m = vm.lastMatch {
                    MatchOverlayView(card: m.card) {
                        vm.dismissMatch()
                    }
                }
            }
            .alert("Couldn't load deck", isPresented: .init(
                get: { vm.error != nil },
                set: { _ in vm.error = nil }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(vm.error ?? "")
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "leaf.fill")
                .font(.system(size: 56))
                .foregroundStyle(OMColor.plum.opacity(0.7))
            Text("Nobody matches your filters right now.")
                .font(OMFont.subhead)
                .multilineTextAlignment(.center)
                .foregroundStyle(OMColor.ink)
            Text("Try broadening your distance or age range. This is free — you'll never be asked to pay.")
                .font(OMFont.callout)
                .foregroundStyle(OMColor.inkMuted)
                .multilineTextAlignment(.center)
            NavigationLink("Adjust filters") {
                LookingForView()
            }
            .buttonStyle(OMPrimaryButtonStyle())
            .padding(.horizontal, 24)
            .padding(.top, 4)
        }
        .padding()
    }

    private func cardStack(in size: CGSize) -> some View {
        ZStack {
            // PERF-I6 — Back card is hoisted into its own view so it
            // does NOT take `dragOffset` as input. Without this, every
            // drag-update frame re-renders the back card's
            // PhotoCarouselView + photo decode — a per-frame waste
            // when the back card is purely decorative.
            backCard
            // Top card: this one *does* depend on dragOffset, but only
            // for transform (offset + rotation). The body inside
            // `ProfileCardView` still runs per-frame for the top card
            // (intent / edge-glow), which is intentional and where the
            // drag feedback lives.
            topCard
        }
    }

    @ViewBuilder
    private var backCard: some View {
        if vm.cards.count > 1 {
            ProfileCardView(
                card: vm.cards[1],
                dragOffset: .zero,
                onLike: {}, onReject: {}, onUndo: {},
                onShowDetail: {},
                canUndo: false,
                displayMode: .preview
            )
            .scaleEffect(0.96)
            .opacity(0.7)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            // Re-render only when the back-card identity changes.
            .id(vm.cards.count > 1 ? vm.cards[1].profileId : "none")
        }
    }

    @ViewBuilder
    private var topCard: some View {
        if let top = vm.top {
            ProfileCardView(
                card: top,
                dragOffset: dragOffset,
                onLike: { Task { await commit(.like) } },
                onReject: { Task { await commit(.reject) } },
                onUndo: { Task { await vm.undo() } },
                onShowDetail: { detailCard = top },
                canUndo: vm.canUndo
            )
            .offset(dragOffset)
            .rotationEffect(.degrees(reduceMotion ? 0 : Double(rotationDegrees(dragOffset.width))))
            .gesture(dragGesture)
            .animation(.interactiveSpring(response: 0.28, dampingFraction: 0.78), value: dragOffset)
            .id(top.profileId)
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                dragOffset = value.translation
                let crossed = abs(value.translation.width) > likeThreshold
                if crossed && !hasCrossedThreshold {
                    Haptics.threshold()
                    hasCrossedThreshold = true
                } else if !crossed && hasCrossedThreshold {
                    hasCrossedThreshold = false
                }
            }
            .onEnded { value in
                let w = value.translation.width
                let velocityProxy = abs(value.predictedEndTranslation.width)
                if w > likeThreshold || (w > 30 && velocityProxy > 500) {
                    Task { await commit(.like) }
                } else if w < -likeThreshold || (w < -30 && velocityProxy > 500) {
                    Task { await commit(.reject) }
                } else {
                    withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.78)) {
                        dragOffset = .zero
                    }
                }
                hasCrossedThreshold = false
            }
    }

    // Tightened from /22 + uncapped to /28 capped at ±14°. The previous
    // value let the card tilt to ~50° on a hard fling which felt cartoonish;
    // a tight cap keeps the motion premium.
    private func rotationDegrees(_ width: CGFloat) -> CGFloat {
        let raw = width / 28
        return min(max(raw, -14), 14)
    }

    private func commit(_ decision: SwipeDecision) async {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.7)) {
            dragOffset = CGSize(width: decision == .like ? 1400 : -1400, height: 0)
        }
        await vm.commit(decision)
        dragOffset = .zero
    }
}
