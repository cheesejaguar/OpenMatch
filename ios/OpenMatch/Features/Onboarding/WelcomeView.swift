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

    // BETA-5 — invite gating. Pre-filled from a universal link
    // (`?invite=…`); the user can also type it. We normalize to
    // uppercase on submit so the wire format is canonical.
    @State private var inviteCode: String = ""

    @State private var revealStep: Int = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // Trimmed + uppercased code; nil when empty so we don't send "" to
    // the backend.
    private var normalizedInvite: String? {
        let trimmed = inviteCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return trimmed.isEmpty ? nil : trimmed
    }

    var body: some View {
        NavigationStack {
            ZStack {
                OMColor.paper.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 22) {
                        Spacer(minLength: 30)
                        botanicMark
                            .opacity(reveal(at: 0))
                            .scaleEffect(reveal(at: 0) > 0 ? 1.0 : 0.96)
                        Text("OpenMatch")
                            .font(OMFont.display(48, weight: .bold, italic: true))
                            .tracking(-1)
                            .foregroundStyle(OMColor.plum)
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
                            TextField("Invite code", text: $inviteCode)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled(true)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityHint("Required during the beta. Tap your invite link or paste your code.")
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
                        .foregroundStyle(OMColor.plum)
                        .padding(.top, 12)
                        .opacity(reveal(at: 4))

                        Spacer(minLength: 20)
                    }
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(OMColor.paper, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .onAppear { startReveal() }
            .onOpenURL { url in
                // Universal-link shape: https://openmatch.app/welcome?invite=ABC123
                // Tolerant of custom schemes too (openmatch://?invite=…).
                if let parsed = Self.parseInviteCode(from: url) {
                    inviteCode = parsed
                }
            }
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
                .foregroundStyle(OMColor.magenta)
                .rotationEffect(.degrees(-30))
                .offset(x: -8, y: 0)
            Image(systemName: "leaf.fill")
                .font(.system(size: 38, weight: .bold))
                .foregroundStyle(OMColor.plum)
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
        await Analytics.shared.record(
            "signup.email_started",
            ["email_domain": .s(Self.emailDomain(email))]
        )
        do {
            let r = try await api.startLogin(email: email, inviteCode: normalizedInvite)
            challengeId = r.challengeId
            if let dev = r.devToken { token = dev }
        } catch {
            self.error = mapInviteError(from: error)
        }
    }

    private func verify() async {
        guard let cid = challengeId else { return }
        do {
            _ = try await api.verifyLogin(challengeId: cid, token: token)
            await Analytics.shared.record("signup.email_verified")
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
            let credential = try await coordinator.signIn()
            _ = try await api.appleLogin(
                identityToken: credential.identityToken,
                rawNonce: credential.rawNonce,
                inviteCode: normalizedInvite
            )
            await Analytics.shared.record("signup.apple_completed")
            appState.didSignIn(userId: api.cachedUserId ?? "self")
        } catch AppleSignInCoordinator.AppleSignInError.cancelled {
            // User cancelled — no error UI.
        } catch {
            self.error = mapInviteError(from: error)
        }
    }

    private func devLogin() async {
        do {
            _ = try await api.devLogin(
                userId: devUserId,
                inviteCode: normalizedInvite
            )
            await Analytics.shared.record("signup.dev_login")
            appState.didSignIn(userId: api.cachedUserId ?? devUserId)
        } catch {
            self.error = mapInviteError(from: error)
        }
    }

    // Maps backend invite-gate errors to user-readable copy. The
    // typed APIError cases below come from the central registry in
    // `backend/src/lib/error-codes.ts`; unrecognised errors fall back
    // to the localised description that APIError.errorDescription
    // produces from the .strings bundle.
    private func mapInviteError(from error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .inviteRequired:
                return "An invite code is required during the beta. Tap your invite link or paste your code above."
            case .inviteInvalid:
                return "That invite code doesn't look right. Double-check the link in your invite email."
            case .inviteExhausted:
                return "That invite code has already been used up. Ask the sender for a fresh one."
            case .inviteExpired:
                return "That invite code has expired."
            case .inviteRevoked:
                return "That invite code has been revoked. Reach out to support if you think this is a mistake."
            case .signupsPaused:
                return "Signups are temporarily paused. Try again later."
            case .outsideMetro:
                return apiError.errorDescription ?? "OpenMatch isn't live in your area yet."
            case .countryNotSupported:
                return apiError.errorDescription ?? "OpenMatch isn't available in your region yet."
            default:
                break
            }
        }
        return error.localizedDescription
    }

    // Extract the domain (after `@`) for funnel segmentation. We
    // intentionally don't send the whole email through analytics — the
    // domain is enough to spot e.g. school cohorts and consumer-vs-work
    // patterns without storing PII in the event store.
    static func emailDomain(_ email: String) -> String {
        guard let at = email.firstIndex(of: "@") else { return "" }
        return String(email[email.index(after: at)...]).lowercased()
    }

    // Universal-link / custom-scheme parser for `?invite=…`.
    // Returns the trimmed, uppercased code or nil if the URL doesn't
    // contain one.
    static func parseInviteCode(from url: URL) -> String? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        guard let raw = comps.queryItems?.first(where: { $0.name == "invite" })?.value else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return trimmed.isEmpty ? nil : trimmed
    }
}
