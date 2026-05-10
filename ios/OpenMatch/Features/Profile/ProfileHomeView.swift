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

struct EditProfileView: View {
    @State private var displayName: String = ""
    @State private var bio: String = ""
    var body: some View {
        Form {
            Section("Basics") {
                TextField("Display name", text: $displayName)
            }
            Section("Bio") {
                TextField("A short bio", text: $bio, axis: .vertical).lineLimit(3...6)
            }
            Section { Button("Save changes") {}.buttonStyle(OMPrimaryButtonStyle()) }
        }
        .navigationTitle("Edit profile")
    }
}

struct ProfilePreviewView: View {
    var body: some View {
        VStack {
            Text("This is how your profile looks to others.")
                .font(.callout).foregroundStyle(.secondary)
            Spacer()
            Text("Preview coming soon.")
            Spacer()
        }
        .padding()
        .navigationTitle("Preview")
    }
}
