import SwiftUI
import UIKit

// Trust & safety automation — selfie-pose verification flow.
//
// Flow:
//   1. User taps "Verify my profile" → we call `/verification/selfie/start`
//      and store the pose prompt + nonce.
//   2. User opens the camera, holds the requested pose, captures a photo.
//   3. We POST the bytes + nonce to `/verification/selfie`; on success we
//      land on a "pending review" confirmation screen.
//
// The flow intentionally does NOT show the user what the on-device
// scanner thinks — the result is for the admin, not for them.

@MainActor
public final class VerificationFlowModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case requestingChallenge
        case awaitingCapture(prompt: String, nonce: String)
        case submitting
        case submitted(requestId: String)
        case error(message: String)
    }

    @Published public var stage: Stage = .idle

    let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    func start() async {
        stage = .requestingChallenge
        do {
            let res = try await api.startSelfieVerification()
            stage = .awaitingCapture(prompt: res.challengePrompt, nonce: res.challengeNonce)
        } catch {
            stage = .error(message: error.localizedDescription)
        }
    }

    func submit(image: UIImage) async {
        guard case let .awaitingCapture(_, nonce) = stage else { return }
        stage = .submitting
        guard let data = ImageUploader.compressForUpload(image) else {
            stage = .error(message: "Couldn't process that photo. Try again.")
            return
        }
        do {
            let res = try await api.submitSelfieVerification(
                challengeNonce: nonce,
                imageData: data
            )
            stage = .submitted(requestId: res.requestId)
        } catch {
            stage = .error(message: error.localizedDescription)
        }
    }
}

public struct VerificationFlowView: View {
    @StateObject private var model: VerificationFlowModel
    @State private var pickerImage: UIImage?
    @State private var showingPicker = false

    public init(api: APIClient) {
        _model = StateObject(wrappedValue: VerificationFlowModel(api: api))
    }

    public var body: some View {
        VStack(spacing: 24) {
            switch model.stage {
            case .idle:
                idleView
            case .requestingChallenge:
                ProgressView("Requesting challenge…")
            case let .awaitingCapture(prompt, _):
                captureView(prompt: prompt)
            case .submitting:
                ProgressView("Uploading…")
            case let .submitted(requestId):
                submittedView(requestId: requestId)
            case let .error(message):
                errorView(message: message)
            }
        }
        .padding(24)
        .navigationTitle("Verify profile")
    }

    private var idleView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add a verified badge to your profile.")
                .font(.title3)
            Text("We'll ask you to hold a quick pose and snap a selfie. An OpenMatch moderator reviews verifications within 24 hours.")
                .font(.body)
                .foregroundStyle(.secondary)
            Button(action: { Task { await model.start() } }) {
                Text("Start verification")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func captureView(prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pose challenge")
                .font(.headline)
            Text(prompt)
                .font(.title3)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.gray.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
            if let pickerImage {
                Image(uiImage: pickerImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            Button(action: { showingPicker = true }) {
                Text(pickerImage == nil ? "Open camera" : "Retake")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.bordered)
            if pickerImage != nil {
                Button(action: {
                    if let image = pickerImage {
                        Task { await model.submit(image: image) }
                    }
                }) {
                    Text("Submit for review")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .sheet(isPresented: $showingPicker) {
            CameraPicker(image: $pickerImage)
        }
    }

    private func submittedView(requestId: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 48))
                .foregroundStyle(.green)
            Text("Thanks — under review")
                .font(.title2)
            Text("We'll let you know within 24 hours. Reference: \(requestId.prefix(8))…")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 36))
                .foregroundStyle(.orange)
            Text("Something went wrong")
                .font(.title3)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try again") {
                Task { await model.start() }
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

// Lightweight UIImagePickerController wrapper. We deliberately use the
// rear UI camera so the user must consciously flip to front-facing —
// which makes "wrong pose / wrong person" mistakes less likely.
private struct CameraPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            picker.sourceType = .camera
            picker.cameraDevice = .front
        } else {
            picker.sourceType = .photoLibrary
        }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let img = info[.originalImage] as? UIImage {
                parent.image = img
            }
            picker.dismiss(animated: true)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true)
        }
    }
}
