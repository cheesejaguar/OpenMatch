import Foundation
import UIKit
import Vision

// Trust & safety automation — on-device photo pre-check.
//
// Runs Apple's built-in Vision classifiers BEFORE uploading a photo so
// we can refuse obviously-NSFW uploads at the client (and tag borderline
// cases so the backend queue surfaces them earlier). The classifier and
// face detector are bundled with the OS — no network calls, no CoreML
// model files to ship.
//
// Decision taxonomy:
//   - `.clean`  — no signals fired. Proceed as normal.
//   - `.flag`   — a low-confidence signal fired (e.g. an explicit-content
//     candidate just under the block threshold). Upload proceeds, but
//     `clientFlaggedAt` is set on the upload so the admin queue sees it.
//   - `.block`  — refuse upload outright. iOS shows a generic "this
//     photo doesn't meet our guidelines" message; we never reveal the
//     specific reason to avoid teaching adversaries our thresholds.

public actor PhotoModerator {
    public static let shared = PhotoModerator()

    public enum Decision: String, Sendable {
        case clean
        case flag
        case block
    }

    public struct Signal: Sendable, Equatable, Codable {
        public let source: String
        public let code: String
        public let score: Double?

        public init(source: String, code: String, score: Double? = nil) {
            self.source = source
            self.code = code
            self.score = score
        }
    }

    public struct Result: Sendable, Equatable {
        public let decision: Decision
        public let signals: [Signal]

        public init(decision: Decision, signals: [Signal]) {
            self.decision = decision
            self.signals = signals
        }
    }

    /// Confidence at or above which we BLOCK a photo outright. Tuned
    /// conservatively so we'd rather flag-for-review than refuse a
    /// legitimate upload — false positives cost us a re-take, false
    /// negatives cost us a bad photo in the admin queue (which the
    /// server safety stack also catches).
    public static let blockThreshold: Float = 0.85
    public static let flagThreshold: Float = 0.55

    /// Identifier strings emitted by VNClassifyImageRequest's "explicit
    /// content" hierarchy. We intersect against this set so an unrelated
    /// label (e.g. "outdoor") never trips the scanner.
    private static let explicitLabels: Set<String> = [
        "explicit_nudity",
        "nudity",
        "explicit",
        "suggestive",
    ]

    public init() {}

    /// Scan a UIImage. Always returns a result; on internal Vision
    /// errors we default to `.clean` (fail-open) because the server-side
    /// moderator is authoritative.
    public func scan(_ image: UIImage) async -> Result {
        guard let cgImage = image.cgImage ?? Self.makeCGImage(from: image) else {
            return Result(decision: .clean, signals: [])
        }
        var signals: [Signal] = []
        var decision: Decision = .clean

        // Explicit-content classifier (Vision built-in).
        if let explicit = await Self.runExplicitContent(on: cgImage) {
            signals.append(explicit.signal)
            if explicit.score >= Self.blockThreshold {
                decision = .block
            } else if explicit.score >= Self.flagThreshold {
                decision = Self.escalate(decision, to: .flag)
            }
        }

        // Face presence — useful as a catfish hint. Zero faces in a
        // profile photo is suspicious; >3 faces means it's likely not a
        // selfie. Neither blocks, both flag.
        if let face = await Self.runFaceCount(on: cgImage) {
            signals.append(face.signal)
            if face.count == 0 || face.count > 3 {
                decision = Self.escalate(decision, to: .flag)
            }
        }

        return Result(decision: decision, signals: signals)
    }

    // MARK: - Private helpers

    private static func escalate(_ current: Decision, to next: Decision) -> Decision {
        switch (current, next) {
        case (.block, _), (_, .block): return .block
        case (.flag, _), (_, .flag): return .flag
        default: return .clean
        }
    }

    private static func makeCGImage(from image: UIImage) -> CGImage? {
        guard let data = image.jpegData(compressionQuality: 0.9),
              let provider = CGDataProvider(data: data as CFData),
              let cg = CGImage(
                  jpegDataProviderSource: provider,
                  decode: nil,
                  shouldInterpolate: false,
                  intent: .defaultIntent
              )
        else { return nil }
        return cg
    }

    private struct ExplicitResult {
        let score: Float
        let signal: Signal
    }

    private static func runExplicitContent(on cgImage: CGImage) async -> ExplicitResult? {
        await withCheckedContinuation { (cont: CheckedContinuation<ExplicitResult?, Never>) in
            let request = VNClassifyImageRequest { req, _ in
                let observations = (req.results as? [VNClassificationObservation]) ?? []
                var topScore: Float = 0
                var topLabel = ""
                for obs in observations {
                    if explicitLabels.contains(obs.identifier) {
                        if obs.confidence > topScore {
                            topScore = obs.confidence
                            topLabel = obs.identifier
                        }
                    }
                }
                if topScore > 0 {
                    cont.resume(
                        returning: ExplicitResult(
                            score: topScore,
                            signal: Signal(
                                source: "vision_classify",
                                code: topLabel,
                                score: Double(topScore)
                            )
                        )
                    )
                } else {
                    cont.resume(returning: nil)
                }
            }
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                cont.resume(returning: nil)
            }
        }
    }

    private struct FaceCountResult {
        let count: Int
        let signal: Signal
    }

    private static func runFaceCount(on cgImage: CGImage) async -> FaceCountResult? {
        await withCheckedContinuation { (cont: CheckedContinuation<FaceCountResult?, Never>) in
            let request = VNDetectFaceRectanglesRequest { req, _ in
                let observations = (req.results as? [VNFaceObservation]) ?? []
                let count = observations.count
                cont.resume(
                    returning: FaceCountResult(
                        count: count,
                        signal: Signal(
                            source: "vision_faces",
                            code: count == 0 ? "no_face" : (count > 3 ? "many_faces" : "face_count_ok"),
                            score: Double(count)
                        )
                    )
                )
            }
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                cont.resume(returning: nil)
            }
        }
    }
}
