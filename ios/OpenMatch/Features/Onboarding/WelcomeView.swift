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
    @State private var appleCoordinator: AppleSignInCoordinator?

    @State private var revealStep: Int = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ZStack {
                OMColor.surface.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 22) {
                        Spacer(minLength: 30)
                        botanicMark
                            .opacity(reveal(at: 0))
                            .scaleEffect(reveal(at: 0) > 0 ? 1.0 : 0.96)
                        Text("OpenMatch")
                            .font(OMFont.display(48, weight: .bold, italic: true))
                            .tracking(-1)
                            .foregroundStyle(OMColor.moss)
                            .opacity(reveal(at: 1))
                            .offset(y: reveal(at: 1) > 0 ? 0 : 6)
                        VStack(spacing: 4) {
                            Text("Open-source dating.")
                            Text("Free core features. Always.")
                            Text("Auditable matching.")
                        }
                        .multilineTextAlignment(.center)
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)
                        .opacity(reveal(at: 2))

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

                            HStack(spacing: 10) {
                                Rectangle().fill(OMColor.divider).frame(height: 1)
                                Text("or")
                                    .font(OMFont.caption)
                                    .foregroundStyle(OMColor.inkMuted)
                                Rectangle().fill(OMColor.divider).frame(height: 1)
                            }
                            .padding(.vertical, 4)

                            Button {
                                Task { await appleLogin() }
                            } label: {
                                Label("Continue with Apple", systemImage: "applelogo")
                            }
                            .buttonStyle(OMSecondaryButtonStyle())
                            .disabled(loading)
                        }
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                        .opacity(reveal(at: 3))

                        DisclosureGroup("Developer login (local dev only)") {
                            VStack(spacing: 8) {
                                TextField("User id", text: $devUserId)
                                    .textFieldStyle(.roundedBorder)
                                Button("Dev sign in") { Task { await devLogin() } }
                                    .buttonStyle(OMGhostButtonStyle())
                            }
                            .padding(.top, 8)
                        }
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                        .padding(.horizontal, 24)
                        .opacity(reveal(at: 4))

                        HStack(spacing: 16) {
                            Link("Privacy", destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/privacy/principles.md")!)
                            Link("Safety", destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/safety/community-guidelines.md")!)
                            Link("Source", destination: URL(string: "https://github.com/cheesejaguar/openmatch")!)
                        }
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.moss)
                        .padding(.top, 12)
                        .opacity(reveal(at: 4))

                        Spacer(minLength: 20)
                    }
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(OMColor.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .onAppear { startReveal() }
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

    private var botanicMark: some View {
        ZStack {
            Circle()
                .fill(OMColor.surfaceElevated)
                .frame(width: 96, height: 96)
                .omShadow(.card)
            // Two facing leaves form an abstract heart.
            Image(systemName: "leaf.fill")
                .font(.system(size: 38, weight: .bold))
                .foregroundStyle(OMColor.terracotta)
                .rotationEffect(.degrees(-30))
                .offset(x: -8, y: 0)
            Image(systemName: "leaf.fill")
                .font(.system(size: 38, weight: .bold))
                .foregroundStyle(OMColor.moss)
                .rotationEffect(.degrees(150))
                .offset(x: 8, y: 0)
        }
    }

    private func reveal(at step: Int) -> Double {
        revealStep >= step ? 1 : 0
    }

    private func startReveal() {
        if reduceMotion {
            revealStep = 5
            return
        }
        // Stagger by ~80ms so the welcome screen lands like a sequence
        // rather than a single hit. Five steps: mark, title, kicker, form, footer.
        for step in 0...4 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(step) * 0.08) {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                    revealStep = step
                }
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
            appState.didSignIn(userId: api.cachedUserId ?? "self")
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func appleLogin() async {
        loading = true
        defer { loading = false }
        let coordinator = AppleSignInCoordinator()
        appleCoordinator = coordinator
        defer { appleCoordinator = nil }
        do {
            let identityToken = try await coordinator.signIn()
            _ = try await api.appleLogin(identityToken: identityToken)
            appState.didSignIn(userId: api.cachedUserId ?? "self")
        } catch AppleSignInCoordinator.AppleSignInError.cancelled {
            // User cancelled — no error UI.
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func devLogin() async {
        do {
            _ = try await api.devLogin(userId: devUserId)
            appState.didSignIn(userId: api.cachedUserId ?? devUserId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
