import Foundation
import SwiftUI

@MainActor
final class SwipeDeckViewModel: ObservableObject {
    @Published var cards: [ProfileCardModel] = []
    @Published var undoStack: [PendingSwipeAction] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var lastMatch: (card: ProfileCardModel, matchId: String)?

    var deckSessionId: String = ""
    var algorithmVersion: String = ""
    var rankingConfigVersion: String = ""

    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    var top: ProfileCardModel? { cards.first }
    var canUndo: Bool { !undoStack.isEmpty }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let deck = try await api.loadDeck(limit: 20)
            deckSessionId = deck.deckSessionId
            algorithmVersion = deck.algorithmVersion
            rankingConfigVersion = deck.rankingConfigVersion
            cards = deck.cards.map(ProfileCardModel.init(from:))
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func commit(_ decision: SwipeDecision) async {
        guard let card = cards.first else { return }
        let pending = PendingSwipeAction(
            id: UUID(),
            card: card,
            decision: decision,
            createdAt: Date()
        )
        cards.removeFirst()
        undoStack.append(pending)
        if undoStack.count > 5 {
            undoStack.removeFirst(undoStack.count - 5)
        }

        do {
            let resp = try await api.swipe(SwipeRequest(
                targetProfileId: card.profileId,
                decision: decision.rawValue,
                deckSessionId: deckSessionId,
                algorithmVersion: algorithmVersion,
                rankingConfigVersion: rankingConfigVersion
            ))
            if let idx = undoStack.firstIndex(where: { $0.id == pending.id }) {
                undoStack[idx].swipeId = resp.swipeId
            }
            if resp.matched, let matchId = resp.matchId {
                lastMatch = (card: card, matchId: matchId)
                Haptics.match()
            }
            if cards.count < 5 {
                await load()
            }
        } catch {
            self.error = error.localizedDescription
            // Optimistic UI: keep the user moving even if the network blip.
        }
    }

    func undo() async {
        guard let last = undoStack.popLast() else {
            Haptics.warning()
            return
        }
        if let swipeId = last.swipeId {
            do {
                try await api.undoSwipe(swipeId: swipeId)
            } catch {
                self.error = error.localizedDescription
            }
        }
        cards.insert(last.card, at: 0)
    }

    func dismissMatch() {
        lastMatch = nil
    }
}
