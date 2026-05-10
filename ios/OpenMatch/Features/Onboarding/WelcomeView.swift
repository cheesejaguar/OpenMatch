import SwiftUI

struct WelcomeView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var api: APIClient
    @State private var email: String = ""
    @State private var challengeId: String?
    @State private var token: String = ""
    @State private var devUserId: String = "u001"
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    Spacer(minLength: 30)
                    Image(systemName: "heart.text.square.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(OMColor.like)
                    Text("OpenMatch")
                        .font(.largeTitle.bold())
                    VStack(spacing: 6) {
                        Text("Open-source dating.")
                        Text("Free core features. Always.")
                        Text("Auditable matching.")
                    }
                    .multilineTextAlignment(.center)
                    .font(.callout)
                    .foregroundStyle(.secondary)

                    VStack(spacing: 12) {
                        TextField("Email", text: $email)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .textFieldStyle(.roundedBorder)
                        Button("Continue with email") { Task { await startEmail() } }
                            .buttonStyle(OMPrimaryButtonStyle())
                            .disabled(email.isEmpty || loading)

                        if challengeId != nil {
                            TextField("6-digit code from email", text: $token)
                                .textFieldStyle(.roundedBorder)
                            Button("Verify") { Task { await verify() } }
                                .buttonStyle(OMPrimaryButtonStyle())
                                .disabled(token.isEmpty)
                        }

                        Text("or").foregroundStyle(.secondary).padding(.vertical, 4)

                        Button {
                            // Apple Sign-In requires a real developer team.
                            // Wire your team's SIWA call here.
                        } label: {
                            Label("Continue with Apple", systemImage: "applelogo")
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 8)

                    DisclosureGroup("Developer login (local dev only)") {
                        VStack(spacing: 8) {
                            TextField("User id", text: $devUserId)
                                .textFieldStyle(.roundedBorder)
                            Button("Dev sign in") { Task { await devLogin() } }
                                .buttonStyle(.bordered)
                        }
                        .padding(.top, 8)
                    }
                    .font(.footnote)
                    .padding(.horizontal, 24)

                    HStack(spacing: 16) {
                        Link("Privacy", destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/privacy/principles.md")!)
                        Link("Safety", destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/safety/community-guidelines.md")!)
                        Link("Source", destination: URL(string: "https://github.com/cheesejaguar/openmatch")!)
                    }
                    .font(.footnote)
                    .padding(.top, 12)

                    Spacer(minLength: 20)
                }
            }
            .navigationTitle("Welcome")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Sign-in error", isPresented: .init(
                get: { error != nil },
                set: { _ in error = nil }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func startEmail() async {
        loading = true
        defer { loading = false }
        do {
            let r = try await api.startLogin(email: email)
            challengeId = r.challengeId
            if let dev = r.devToken { token = dev }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func verify() async {
        guard let cid = challengeId else { return }
        do {
            _ = try await api.verifyLogin(challengeId: cid, token: token)
            appState.auth = .loggedIn(userId: api.cachedUserId ?? "self")
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func devLogin() async {
        do {
            _ = try await api.devLogin(userId: devUserId)
            appState.auth = .loggedIn(userId: api.cachedUserId ?? devUserId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
