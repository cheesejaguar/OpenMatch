import PhotosUI
import SwiftUI

struct ProfileHomeView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            OMScreen {
                ScrollView {
                    LazyVStack(spacing: OMSpacing.xl) {
                        // Profile summary card
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(spacing: OMSpacing.lg) {
                                BotanicPlaceholder(.avatar(64))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Your profile")
                                        .font(OMFont.body(16, weight: .semibold))
                                        .foregroundStyle(OMColor.ink)
                                    Text("Tap to edit your basics, photos, and bio.")
                                        .font(OMFont.caption)
                                        .foregroundStyle(OMColor.inkMuted)
                                }
                                Spacer()
                            }
                            .padding(OMSpacing.lg)
                            OMSectionDivider()
                            NavigationLink {
                                EditProfileView()
                            } label: {
                                OMRow("Edit profile", systemImage: "pencil", chevron: true)
                            }
                            .buttonStyle(.plain)
                            OMSectionDivider()
                            NavigationLink {
                                ProfilePreviewView()
                            } label: {
                                OMRow("Preview as others see it", systemImage: "eye", chevron: true)
                            }
                            .buttonStyle(.plain)
                        }
                        .background(
                            OMShape.card(OMRadius.lg).fill(OMColor.surfaceElevated)
                        )
                        .overlay(
                            OMShape.card(OMRadius.lg).stroke(OMColor.cardStroke, lineWidth: 1)
                        )
                        .omShadow(.card)

                        OMSection("Discovery") {
                            NavigationLink {
                                LookingForView()
                            } label: {
                                OMRow("Looking for", systemImage: "slider.horizontal.3", chevron: true)
                            }
                            .buttonStyle(.plain)
                            OMSectionDivider()
                            NavigationLink {
                                AlgorithmView()
                            } label: {
                                OMRow("Algorithm transparency", systemImage: "doc.text.magnifyingglass", chevron: true)
                            }
                            .buttonStyle(.plain)
                        }

                        OMSection("Privacy & Safety") {
                            NavigationLink {
                                SettingsView()
                            } label: {
                                OMRow("Settings", systemImage: "gearshape", chevron: true)
                            }
                            .buttonStyle(.plain)
                            OMSectionDivider()
                            NavigationLink {
                                SafetyCenterView()
                            } label: {
                                OMRow("Safety center", systemImage: "shield.lefthalf.filled", iconTint: OMColor.cinnabar, chevron: true)
                            }
                            .buttonStyle(.plain)
                            OMSectionDivider()
                            NavigationLink {
                                BlockedUsersView()
                            } label: {
                                OMRow("Blocked users", systemImage: "person.slash", chevron: true)
                            }
                            .buttonStyle(.plain)
                        }

                        OMSection("About") {
                            Link(destination: URL(string: "https://github.com/cheesejaguar/openmatch")!) {
                                OMRow("Open source on GitHub", systemImage: "chevron.left.forwardslash.chevron.right", chevron: true)
                            }
                            OMSectionDivider()
                            Link(destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/safety/community-guidelines.md")!) {
                                OMRow("Community guidelines", systemImage: "doc.text", chevron: true)
                            }
                            OMSectionDivider()
                            Link(destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/privacy/principles.md")!) {
                                OMRow("Privacy principles", systemImage: "hand.raised", chevron: true)
                            }
                        }

                        Button {
                            appState.signOut()
                        } label: {
                            Text("Sign out")
                                .font(OMFont.body(16, weight: .semibold))
                                .foregroundStyle(OMColor.cinnabar)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                        }
                        .background(
                            OMShape.card(OMRadius.lg).fill(OMColor.surfaceElevated)
                        )
                        .overlay(
                            OMShape.card(OMRadius.lg).stroke(OMColor.cinnabar.opacity(0.30), lineWidth: 1)
                        )
                    }
                    .padding(.horizontal, OMSpacing.lg)
                    .padding(.vertical, OMSpacing.lg)
                }
            }
            .omNavTitle("You")
        }
    }
}

@MainActor
final class EditProfileViewModel: ObservableObject {
    @Published var displayName: String = ""
    @Published var bio: String = ""
    @Published var city: String = ""
    @Published var photos: [PhotoDTO] = []
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var uploadingPhoto = false
    @Published var error: String?
    @Published var saved = false

    var api: APIClient?

    static let maxPhotos = 9

    func load() async {
        guard let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let p = try await api.getProfile()
            displayName = p.displayName
            bio = p.bio
            city = p.city ?? ""
            photos = p.photos
        } catch {
            self.error = error.localizedDescription
        }
    }

    func save() async {
        guard let api else { return }
        isSaving = true
        defer { isSaving = false }
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedBio = bio.trimmingCharacters(in: .whitespacesAndNewlines)
        let patch = ProfileUpdateRequest(
            displayName: trimmedName.isEmpty ? nil : trimmedName,
            bio: trimmedBio,
            city: city.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : city
        )
        do {
            _ = try await api.updateProfile(patch)
            saved = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    func upload(_ image: UIImage) async {
        guard let api else { return }
        guard photos.count < Self.maxPhotos else {
            error = "You can have at most \(Self.maxPhotos) photos."
            return
        }
        guard let data = ImageUploader.compressForUpload(image) else {
            error = "Couldn't process that photo. Try a different one."
            return
        }
        uploadingPhoto = true
        defer { uploadingPhoto = false }
        do {
            let photo = try await api.uploadPhoto(data: data)
            photos.append(photo)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func remove(_ photo: PhotoDTO) async {
        guard let api else { return }
        do {
            try await api.deletePhoto(id: photo.id)
            photos.removeAll { $0.id == photo.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct EditProfileView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = EditProfileViewModel()
    @State private var pickedItem: PhotosPickerItem?

    var body: some View {
        OMScreen {
            ScrollView {
                LazyVStack(spacing: OMSpacing.xl) {
                    OMSection(
                        "Photos",
                        footer: "Up to \(EditProfileViewModel.maxPhotos) photos. Drag to reorder coming soon."
                    ) {
                        photoGrid
                            .padding(OMSpacing.lg)
                        if vm.photos.count < EditProfileViewModel.maxPhotos {
                            OMSectionDivider()
                            addPhotoPicker(isUploading: vm.uploadingPhoto)
                        }
                    }

                    OMSection("Basics") {
                        labeledField("Display name") {
                            TextField("How you'll show up", text: $vm.displayName)
                                .textInputAutocapitalization(.words)
                                .textFieldStyle(.plain)
                                .font(OMFont.bodyRegular)
                        }
                        OMSectionDivider()
                        labeledField("City") {
                            TextField("Optional", text: $vm.city)
                                .textInputAutocapitalization(.words)
                                .textFieldStyle(.plain)
                                .font(OMFont.bodyRegular)
                        }
                    }

                    OMSection("Bio") {
                        VStack(alignment: .leading, spacing: 6) {
                            TextField("A short bio", text: $vm.bio, axis: .vertical)
                                .lineLimit(3...6)
                                .textFieldStyle(.plain)
                                .font(OMFont.bodyRegular)
                                .foregroundStyle(OMColor.ink)
                        }
                        .padding(OMSpacing.lg)
                    }

                    Button {
                        Task { await vm.save() }
                    } label: {
                        if vm.isSaving { ProgressView().tint(OMColor.onAccent) } else { Text("Save changes") }
                    }
                    .buttonStyle(OMPrimaryButtonStyle())
                    .disabled(vm.isSaving || vm.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, OMSpacing.lg)
                .padding(.vertical, OMSpacing.lg)
            }
        }
        .omNavTitle("Edit profile")
        .task {
            vm.api = api
            if !vm.isLoading && vm.displayName.isEmpty {
                await vm.load()
            }
        }
        .onChange(of: pickedItem) { _, newItem in
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await vm.upload(image)
                }
                pickedItem = nil
            }
        }
        .overlay {
            if vm.isLoading { ProgressView().controlSize(.large).tint(OMColor.plum) }
        }
        .alert("Saved", isPresented: $vm.saved) {
            Button("OK", role: .cancel) {}
        }
        .alert("Couldn't save", isPresented: .init(
            get: { vm.error != nil },
            set: { _ in vm.error = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.error ?? "")
        }
    }

    @ViewBuilder
    private func labeledField<Field: View>(_ label: String, @ViewBuilder field: () -> Field) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(OMFont.caption.weight(.semibold))
                .tracking(1)
                .foregroundStyle(OMColor.inkMuted)
            field()
                .foregroundStyle(OMColor.ink)
        }
        .padding(.horizontal, OMSpacing.lg)
        .padding(.vertical, 12)
    }

    private var photoGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 90, maximum: 110), spacing: 8)]
        return LazyVGrid(columns: columns, spacing: 8) {
            ForEach(vm.photos) { photo in
                PhotoTile(photo: photo) {
                    Task { await vm.remove(photo) }
                }
            }
        }
    }

    @ViewBuilder
    private func addPhotoPicker(isUploading: Bool) -> some View {
        PhotosPicker(
            selection: $pickedItem,
            matching: .images,
            photoLibrary: .shared()
        ) {
            HStack(spacing: OMSpacing.md) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(OMColor.magenta)
                Text(isUploading ? "Uploading…" : "Add a photo")
                    .font(OMFont.body(16, weight: .medium))
                    .foregroundStyle(OMColor.ink)
                Spacer()
            }
            .padding(.horizontal, OMSpacing.lg)
            .padding(.vertical, 14)
        }
        .disabled(isUploading)
    }
}

private struct PhotoTile: View {
    let photo: PhotoDTO
    let onDelete: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            // PERF-I4 — 100pt × screen scale (≤ 300px on 3x) is plenty
            // for an edit-grid thumbnail.
            OMImage(url: URL(string: photo.cdnUrl), thumbnailMaxPixelSize: 300)
                .scaledToFill()
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

struct ProfilePreviewView: View {
    @EnvironmentObject private var api: APIClient
    @State private var profile: ProfileDTO?
    @State private var error: String?

    var body: some View {
        OMScreen {
            ScrollView {
                VStack(alignment: .leading, spacing: OMSpacing.lg) {
                    Text("This is how your profile looks to others.")
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)
                    if let profile {
                        if let firstPhoto = profile.photos.first {
                            // PERF-I4 — 320pt preview at ≤ 3x scale
                            // covers a 1080px-wide hero comfortably.
                            OMImage(url: URL(string: firstPhoto.cdnUrl), thumbnailMaxPixelSize: 1200)
                                .scaledToFill()
                                .frame(height: 320)
                                .frame(maxWidth: .infinity)
                                .clipShape(OMShape.card())
                        } else {
                            BotanicPlaceholder(.large)
                                .frame(height: 320)
                                .frame(maxWidth: .infinity)
                                .clipShape(OMShape.card())
                        }
                        VStack(alignment: .leading, spacing: OMSpacing.sm) {
                            Text(profile.displayName)
                                .font(OMFont.display(28, weight: .semibold, italic: true))
                                .foregroundStyle(OMColor.ink)
                            if let city = profile.city, !city.isEmpty {
                                HStack(spacing: 6) {
                                    Image(systemName: "location.fill")
                                        .imageScale(.small)
                                        .foregroundStyle(OMColor.plum)
                                    Text(city)
                                        .font(OMFont.callout)
                                        .foregroundStyle(OMColor.inkMuted)
                                }
                            }
                            if !profile.bio.isEmpty {
                                Text(profile.bio)
                                    .font(OMFont.bodyRegular)
                                    .foregroundStyle(OMColor.ink)
                                    .padding(.top, 4)
                            }
                            if !profile.interests.isEmpty {
                                Text("Interests")
                                    .font(OMFont.display(14, weight: .semibold, italic: true))
                                    .tracking(1.2)
                                    .foregroundStyle(OMColor.plum)
                                    .padding(.top, OMSpacing.sm)
                                FlowChips(items: profile.interests)
                            }
                        }
                    } else if error == nil {
                        ProgressView().tint(OMColor.plum).frame(maxWidth: .infinity)
                    }
                }
                .padding(OMSpacing.lg)
            }
        }
        .omNavTitle("Preview")
        .task {
            do { profile = try await api.getProfile() }
            catch { self.error = error.localizedDescription }
        }
        .alert("Couldn't load profile", isPresented: .init(
            get: { error != nil },
            set: { _ in error = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }
}

private struct FlowChips: View {
    let items: [String]

    var body: some View {
        // Wrap chips into rows manually since SwiftUI lacks a true flow layout
        // on iOS 17. Cap at ~3 per row visually; longer interest strings will
        // wrap naturally on smaller screens.
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { interest in
                Text(interest)
                    .font(OMFont.caption.weight(.semibold))
                    .foregroundStyle(OMColor.plum)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        OMShape.chip().fill(OMColor.surfaceSunken)
                    )
                    .overlay(
                        OMShape.chip().stroke(OMColor.plum.opacity(0.20), lineWidth: 1)
                    )
            }
        }
    }
}

// Minimal flow layout for chip wrapping. Uses SwiftUI Layout protocol.
private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let (height, _) = layout(in: width, subviews: subviews)
        return CGSize(width: width.isFinite ? width : 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (_, placements) = layout(in: bounds.width, subviews: subviews)
        for (idx, point) in placements.enumerated() {
            subviews[idx].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }

    private func layout(in width: CGFloat, subviews: Subviews) -> (CGFloat, [CGPoint]) {
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var placements: [CGPoint] = []
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            placements.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (y + rowHeight, placements)
    }
}
