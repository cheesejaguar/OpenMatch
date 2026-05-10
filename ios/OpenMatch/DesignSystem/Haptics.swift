import UIKit

enum Haptics {
    private static let selection = UISelectionFeedbackGenerator()
    private static let success = UINotificationFeedbackGenerator()
    private static let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private static let warningGen = UINotificationFeedbackGenerator()

    static func threshold() { lightImpact.impactOccurred(intensity: 0.6) }
    static func match()     { success.notificationOccurred(.success) }
    static func warning()   { warningGen.notificationOccurred(.warning) }
    static func tick()      { selection.selectionChanged() }
}
