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
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var error: String?
    @Published var saved = false

    var api: APIClient?

    func load() async {
        guard let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let p = try await api.getProfile()
            displayName = p.displayName
            bio = p.bio
            city = p.city ?? ""
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
}

struct EditProfileView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm = EditProfileViewModel()

    var body: some View {
        Form {
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
        .overlay {
            if vm.isLoading {
                ProgressView().controlSize(.large)
            }
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
}

struct ProfilePreviewView: View {
    @EnvironmentObject private var api: APIClient
    @State private var profile: ProfileDTO?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("This is how your profile looks to others.")
                .font(.callout).foregroundStyle(.secondary)
            if let profile {
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
            Spacer()
        }
        .padding()
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
