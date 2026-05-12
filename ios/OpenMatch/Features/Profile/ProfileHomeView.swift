import PhotosUI
import SwiftUI

struct ProfileHomeView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        Circle().fill(OMColor.surfaceMuted).frame(width: 64, height: 64)
                            .overlay(Image(systemName: "person.crop.circle.fill").font(.largeTitle).foregroundStyle(.secondary))
                        VStack(alignment: .leading) {
                            Text("Your profile").font(.headline)
                            Text("Tap to edit your basics, photos, and bio.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    NavigationLink("Edit profile") { EditProfileView() }
                    NavigationLink("Preview as others see it") { ProfilePreviewView() }
                }
                Section("Discovery") {
                    NavigationLink("Looking for") { LookingForView() }
                    NavigationLink("Algorithm transparency") { AlgorithmView() }
                }
                Section("Privacy & Safety") {
                    NavigationLink("Settings") { SettingsView() }
                    NavigationLink("Safety center") { SafetyCenterView() }
                    NavigationLink("Blocked users") { BlockedUsersView() }
                }
                Section("About") {
                    Link("Open source on GitHub", destination: URL(string: "https://github.com/cheesejaguar/openmatch")!)
                    Link("Community guidelines", destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/safety/community-guidelines.md")!)
                    Link("Privacy principles", destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/privacy/principles.md")!)
                }
                Section {
                    Button("Sign out", role: .destructive) {
                        appState.signOut()
                    }
                }
            }
            .navigationTitle("You")
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
        Form {
            Section("Photos") {
                photoGrid
                if vm.photos.count < EditProfileViewModel.maxPhotos {
                    addPhotoPicker(isUploading: vm.uploadingPhoto)
                }
                Text("Up to \(EditProfileViewModel.maxPhotos) photos. Drag to reorder coming soon.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Basics") {
                TextField("Display name", text: $vm.displayName)
                    .textInputAutocapitalization(.words)
                TextField("City", text: $vm.city)
                    .textInputAutocapitalization(.words)
            }
            Section("Bio") {
                TextField("A short bio", text: $vm.bio, axis: .vertical).lineLimit(3...6)
            }
            Section {
                Button {
                    Task { await vm.save() }
                } label: {
                    if vm.isSaving { ProgressView() } else { Text("Save changes") }
                }
                .buttonStyle(OMPrimaryButtonStyle())
                .disabled(vm.isSaving || vm.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .navigationTitle("Edit profile")
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
            if vm.isLoading { ProgressView().controlSize(.large) }
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

    private var photoGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 90, maximum: 110), spacing: 8)]
        return LazyVGrid(columns: columns, spacing: 8) {
            ForEach(vm.photos) { photo in
                PhotoTile(photo: photo) {
                    Task { await vm.remove(photo) }
                }
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func addPhotoPicker(isUploading: Bool) -> some View {
        PhotosPicker(
            selection: $pickedItem,
            matching: .images,
            photoLibrary: .shared()
        ) {
            Label(isUploading ? "Uploading…" : "Add a photo", systemImage: "plus.circle.fill")
        }
        .disabled(isUploading)
    }
}

private struct PhotoTile: View {
    let photo: PhotoDTO
    let onDelete: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            AsyncImage(url: URL(string: photo.cdnUrl)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .empty:
                    ProgressView()
                case .failure:
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                @unknown default:
                    EmptyView()
                }
            }
            .frame(width: 100, height: 100)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .background(OMColor.surfaceMuted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            Button(role: .destructive, action: onDelete) {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.6))
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
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("This is how your profile looks to others.")
                    .font(.callout).foregroundStyle(.secondary)
                if let profile {
                    if let firstPhoto = profile.photos.first {
                        AsyncImage(url: URL(string: firstPhoto.cdnUrl)) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            ProgressView()
                        }
                        .frame(height: 320)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(profile.displayName).font(.title).fontWeight(.semibold)
                        if let city = profile.city, !city.isEmpty {
                            Text(city).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if !profile.bio.isEmpty {
                            Text(profile.bio).padding(.top, 8)
                        }
                        if !profile.interests.isEmpty {
                            Text("Interests").font(.headline).padding(.top, 8)
                            Text(profile.interests.joined(separator: " • "))
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                } else if error == nil {
                    ProgressView()
                }
            }
            .padding()
        }
        .navigationTitle("Preview")
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
