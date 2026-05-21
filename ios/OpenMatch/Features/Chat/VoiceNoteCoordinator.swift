import AVFoundation
import Foundation

// Local-only voice-note recorder + player. The recorder writes to a
// temp .m4a (AAC, 64 kbps mono, 22.05 kHz) which is small enough that a
// 60-second cap stays under the backend's 500KB limit. On stop the
// recorded bytes + measured duration are returned to the caller, which
// uploads them via APIClient.sendVoiceNote().
//
// Player: feeds a remote signed URL into AVAudioPlayer. We download the
// bytes upfront (≤500KB) and play out of memory rather than streaming
// so the play-from-tap latency stays predictable on flaky cell.
final class VoiceNoteCoordinator: NSObject {
    static let maxDurationMs: Int = 60_000
    static let mimeType = "audio/m4a"

    private var recorder: AVAudioRecorder?
    private var recordedURL: URL?
    private var startedAt: Date?

    // Begin recording into a temp file. Throws if the session can't be
    // configured (typically: mic permission not granted, or another app
    // owns the audio session). The view-model is responsible for
    // surfacing the error to the user.
    func startRecording() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try session.setActive(true)

        let url = URL(
            fileURLWithPath: NSTemporaryDirectory()
        )
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVNumberOfChannelsKey: 1,
            AVSampleRateKey: 22_050,
            AVEncoderBitRateKey: 64_000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        guard recorder.record(forDuration: TimeInterval(Self.maxDurationMs) / 1000.0) else {
            throw NSError(domain: "OpenMatch.VoiceNote", code: -1)
        }
        self.recorder = recorder
        self.recordedURL = url
        self.startedAt = Date()
    }

    // Stop and return the captured (data, durationMs). Returns nil when
    // the recording was too short to be meaningful (<200ms) — protects
    // the backend from accidental tap-and-release-immediately uploads.
    func stopRecording() -> (data: Data, durationMs: Int)? {
        guard let recorder, let recordedURL, let startedAt else { return nil }
        recorder.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let durationMs = Int(Date().timeIntervalSince(startedAt) * 1000.0)
        self.recorder = nil
        self.recordedURL = nil
        self.startedAt = nil
        guard durationMs >= 200 else {
            try? FileManager.default.removeItem(at: recordedURL)
            return nil
        }
        guard let data = try? Data(contentsOf: recordedURL) else { return nil }
        try? FileManager.default.removeItem(at: recordedURL)
        return (data, min(durationMs, Self.maxDurationMs))
    }

    // Cancel without uploading. Cleans up the temp file.
    func cancelRecording() {
        recorder?.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if let recordedURL { try? FileManager.default.removeItem(at: recordedURL) }
        recorder = nil
        recordedURL = nil
        startedAt = nil
    }

    var isRecording: Bool { recorder?.isRecording == true }
}

// Lightweight one-message playback. Resolves a signed URL via the
// backend, downloads bytes into memory, and plays via AVAudioPlayer.
// Tapping the bubble again toggles play/pause. The coordinator owns a
// single player at a time — starting a new playback stops the previous.
@MainActor
final class VoiceNotePlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    static let shared = VoiceNotePlayer()

    @Published private(set) var playingMessageId: String?
    @Published private(set) var progress: Double = 0
    private var player: AVAudioPlayer?
    private var timer: Timer?

    func play(messageId: String, api: APIClient) async {
        if playingMessageId == messageId, player?.isPlaying == true {
            stop()
            return
        }
        stop()
        do {
            let dto = try await api.audioURL(messageId: messageId)
            guard let url = URL(string: dto.url, relativeTo: api.baseURL) else { return }
            var req = URLRequest(url: url)
            // The signed URL is the credential; no Authorization header.
            req.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, _) = try await URLSession.shared.data(for: req)
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            let p = try AVAudioPlayer(data: data)
            p.delegate = self
            p.prepareToPlay()
            p.play()
            self.player = p
            self.playingMessageId = messageId
            self.progress = 0
            // Drive a per-100ms progress update so the SwiftUI waveform
            // bar can animate without subscribing to AVAudioPlayer KVO.
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let player = self.player else { return }
                    self.progress = player.duration > 0
                        ? player.currentTime / player.duration
                        : 0
                }
            }
        } catch {
            // Best-effort. UI shows no feedback beyond "play didn't start".
        }
    }

    func stop() {
        player?.stop()
        timer?.invalidate()
        timer = nil
        player = nil
        playingMessageId = nil
        progress = 0
    }

    nonisolated func audioPlayerDidFinishPlaying(
        _ player: AVAudioPlayer,
        successfully _: Bool
    ) {
        Task { @MainActor in self.stop() }
    }
}
