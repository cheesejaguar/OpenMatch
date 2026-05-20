import PhotosUI
import SwiftUI

struct OnboardingFlowView: View {
    let userId: String
    @EnvironmentObject private var appState: AppState
    @State private var step = 0

    var body: some View {
        VStack {
            switch step {
            case 0:
                StepBasics(onNext: { step += 1 })
            case 1:
                StepPhotos(onNext: { step += 1 })
            case 2:
                StepAgeGate(onNext: { step += 1 })
            case 3:
                StepLikesVisibility(onNext: { step += 1 })
            default:
                StepDone(onFinish: {
                    Task { await Analytics.shared.record("onboarding.completed") }
                    appState.didSignIn(userId: userId)
                })
            }
        }
        .animation(.easeInOut, value: step)
    }
}

private struct StepBasics: View {
    let onNext: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Welcome").font(OMFont.largeTitleItalic).foregroundStyle(OMColor.plum)
            Text("Tell us the basics. You can change everything later. The minimum for a complete profile is two photos, a display name, and your age.")
            Button("Continue", action: onNext).buttonStyle(OMPrimaryButtonStyle())
        }
        .padding()
    }
}

// IOS-5 — photos step. The server discovery filter requires at least
// two photos before a profile is shown in any deck, so we enforce the
// same floor here. The user can add up to 6 in onboarding; more can
// be added later from Edit Profile (cap of 9).
private struct StepPhotos: View {
    let onNext: () -> Void
    @EnvironmentObject private var appState: AppState
    @State private var photos: [PhotoDTO] = []
    @State private var pickedItem: PhotosPickerItem?
    @State private var isLoading = false
    @State private var isUploading = false
    @State private var error: String?

    private static let minPhotos = 2
    private static let maxOnboardingPhotos = 6

    private var canContinue: Bool { photos.count >= Self.minPhotos }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Add at least 2 photos")
                    .font(OMFont.largeTitleItalic)
                    .foregroundStyle(OMColor.plum)
                Text("Real photos of you, no filters. You'll need two before you can browse — this is the same minimum we apply to everyone you might see.")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                photoGrid

                if photos.count < Self.maxOnboardingPhotos {
                    PhotosPicker(
                        selection: $pickedItem,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        HStack(spacing: 10) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(OMColor.magenta)
                            Text(isUploading ? "Uploading…" : "Add a photo")
                                .font(OMFont.body(16, weight: .medium))
                                .foregroundStyle(OMColor.ink)
                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(
                            OMShape.card(OMRadius.md).fill(OMColor.surfaceElevated)
                        )
                        .overlay(
                            OMShape.card(OMRadius.md).stroke(OMColor.cardStroke, lineWidth: 1)
                        )
                    }
                    .disabled(isUploading)
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(OMColor.cinnabar)
                }

                Button {
                    Task {
                        await Analytics.shared.record(
                            "onboarding.photos_completed",
                            ["count": .i(photos.count)]
                        )
                        onNext()
                    }
                } label: {
                    Text(canContinue
                        ? "Continue"
                        : "Add \(Self.minPhotos - photos.count) more")
                }
                .buttonStyle(OMPrimaryButtonStyle())
                .disabled(!canContinue || isUploading)
            }
            .padding()
        }
        .task { await load() }
        .onChange(of: pickedItem) { _, newItem in
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await upload(image)
                }
                pickedItem = nil
            }
        }
    }

    private var photoGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 96, maximum: 110), spacing: 8)]
        return LazyVGrid(columns: columns, spacing: 8) {
            ForEach(photos) { photo in
                OnboardingPhotoTile(photo: photo) {
                    Task { await remove(photo) }
                }
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let p = try await appState.api.getProfile()
            photos = p.photos
        } catch {
            // First-time onboarding profile may not exist yet; leave
            // photos empty rather than blocking the user with an alert.
        }
    }

    private func upload(_ image: UIImage) async {
        guard photos.count < Self.maxOnboardingPhotos else { return }
        guard let data = ImageUploader.compressForUpload(image) else {
            error = "Couldn't process that photo. Try a different one."
            return
        }
        isUploading = true
        defer { isUploading = false }
        error = nil
        do {
            let photo = try await appState.api.uploadPhoto(data: data)
            photos.append(photo)
            await Analytics.shared.record("onboarding.photo_uploaded")
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ photo: PhotoDTO) async {
        do {
            try await appState.api.deletePhoto(id: photo.id)
            photos.removeAll { $0.id == photo.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct OnboardingPhotoTile: View {
    let photo: PhotoDTO
    let onDelete: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            AsyncImage(url: URL(string: photo.cdnUrl)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .empty:
                    ProgressView().tint(OMColor.plum)
                case .failure:
                    BotanicPlaceholder(.large)
                @unknown default:
                    EmptyView()
                }
            }
            .frame(width: 100, height: 100)
            .clipShape(OMShape.card(OMRadius.md))
            .background(OMColor.surfaceSunken, in: OMShape.card(OMRadius.md))

            Button(role: .destructive, action: onDelete) {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(OMColor.paper, OMColor.ink.opacity(0.55))
                    .font(.title3)
            }
            .padding(4)
            .accessibilityLabel("Remove photo")
        }
    }
}

// 18+ age gate.
//
// Why a DOB picker and not an "I am 18+" checkbox: case law and
// regulator practice consistently treat a checkbox as the weakest form
// of age assurance, and the AADC / UK Children's Code / DSA Art. 28
// expect more. A DOB picker is the floor.
//
// Server-side, profile.ts re-validates and refuses with HTTP 403
// "underage". Layered assurance (Apple Declared Age Range + escalation
// to document verification on signal) is tracked in compliance roadmap
// §1.3.
private struct StepAgeGate: View {
    let onNext: () -> Void
    @EnvironmentObject private var appState: AppState
    @State private var dob: Date = {
        // Default selection is 25 years ago so the picker never starts
        // on a date that would be underage (which would be a confusing
        // first read for someone who just tapped past Welcome).
        Calendar.current.date(byAdding: .year, value: -25, to: Date()) ?? Date()
    }()
    @State private var isSaving = false
    @State private var error: String?

    private var ageYears: Int {
        Calendar.current.dateComponents([.year], from: dob, to: Date()).year ?? 0
    }
    private var meetsThreshold: Bool { ageYears >= 18 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your date of birth").font(OMFont.largeTitleItalic).foregroundStyle(OMColor.plum)
            Text("OpenMatch is 18+. We never show your date of birth to other users — only your age, if you choose to display it.")
                .font(.callout).foregroundStyle(.secondary)

            DatePicker(
                "Date of birth",
                selection: $dob,
                in: ...Date(),
                displayedComponents: [.date]
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity)

            if !meetsThreshold {
                Label(
                    "OpenMatch is only available to people aged 18 or older.",
                    systemImage: "exclamationmark.shield"
                )
                .foregroundStyle(OMColor.cinnabar)
                .font(.footnote)
            }

            if let error {
                Text(error).font(.footnote).foregroundStyle(OMColor.cinnabar)
            }

            Button {
                Task { await submit() }
            } label: {
                if isSaving { ProgressView() } else { Text("Continue") }
            }
            .buttonStyle(OMPrimaryButtonStyle())
            .disabled(!meetsThreshold || isSaving)
        }
        .padding()
    }

    private func submit() async {
        isSaving = true; defer { isSaving = false }
        error = nil
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withFullDate]
        var patch = ProfileUpdateRequest()
        patch.dateOfBirth = iso.string(from: dob)
        do {
            _ = try await appState.api.updateProfile(patch)
            // Record ToS + privacy notice + Art. 9 consents up front;
            // each is independently recorded so withdrawals are precise.
            try? await appState.api.recordConsent(scope: "terms_of_service", granted: true)
            try? await appState.api.recordConsent(scope: "privacy_notice", granted: true)
            try? await appState.api.recordConsent(scope: "art9_processing", granted: true)
            onNext()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct StepLikesVisibility: View {
    let onNext: () -> Void
    @State private var choice: LikesVisibility = .visible
    var body: some View {
        VStack(alignment: .leading, spacing: OMSpacing.md) {
            Text("Who liked you").font(OMFont.largeTitleItalic).foregroundStyle(OMColor.plum)
            Text("Seeing who liked you is always free. You can choose how it's shown — change anytime.")
                .font(OMFont.callout)
                .foregroundStyle(OMColor.inkMuted)
            OMSegmented(
                selection: $choice,
                options: [
                    (label: "Visible", value: .visible),
                    (label: "Count", value: .count_only),
                    (label: "Hidden", value: .hidden),
                ]
            )
            .padding(.top, 4)
            Button("Continue", action: onNext).buttonStyle(OMPrimaryButtonStyle())
        }
        .padding()
    }
}

private struct StepDone: View {
    let onFinish: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 56)).foregroundStyle(OMColor.marigold)
            Text("You're in.").font(OMFont.largeTitleItalic).foregroundStyle(OMColor.plum)
            Text("Open the Swipe tab to start browsing. Undo, filters, and seeing likes — all free.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Start swiping", action: onFinish).buttonStyle(OMPrimaryButtonStyle())
        }
        .padding(24)
    }
}
