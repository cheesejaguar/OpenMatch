import SwiftUI

struct SwipeDeckView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm: SwipeDeckViewModel
    @State private var dragOffset: CGSize = .zero
    @State private var detailCard: ProfileCardModel?
    @State private var hasCrossedThreshold = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let likeThreshold: CGFloat = 110

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
            Image(systemName: "sparkles")
                .font(.system(size: 56))
                .foregroundStyle(OMColor.like.opacity(0.7))
            Text("Nobody matches your filters right now.")
                .font(.title3).fontWeight(.semibold)
                .multilineTextAlignment(.center)
            Text("Try broadening your distance or age range. This is free — you'll never be asked to pay.")
                .font(.callout)
                .foregroundStyle(.secondary)
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
            // Behind card (next)
            if vm.cards.count > 1 {
                ProfileCardView(
                    card: vm.cards[1],
                    dragOffset: .zero,
                    onLike: {}, onReject: {}, onUndo: {},
                    onShowDetail: {},
                    canUndo: false
                )
                .scaleEffect(0.96)
                .opacity(0.7)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            // Top card
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
                .rotationEffect(.degrees(reduceMotion ? 0 : Double(dragOffset.width / 22)))
                .gesture(dragGesture)
                .animation(.spring(response: 0.32, dampingFraction: 0.82), value: dragOffset)
                .id(top.profileId)
            }
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
                    dragOffset = .zero
                }
                hasCrossedThreshold = false
            }
    }

    private func commit(_ decision: SwipeDecision) async {
        withAnimation(.easeOut(duration: 0.22)) {
            dragOffset = CGSize(width: decision == .like ? 1200 : -1200, height: 0)
        }
        await vm.commit(decision)
        dragOffset = .zero
    }
}
