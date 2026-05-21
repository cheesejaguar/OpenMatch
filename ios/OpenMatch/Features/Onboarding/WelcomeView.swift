import SwiftUI

struct WelcomeView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var api: APIClient
    @State private var email: String = ""
    @State private var challengeId: String?
    @State private var token: String = ""
    // SEV-M4 — Dev-only state. Gated so the field isn't allocated in
    // Release builds where the disclosure-group is absent.
    #if DEBUG
    @State private var devUserId: String = "u001"
    #endif
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
                        Text("welcome.title")
                            .font(OMFont.display(48, weight: .bold, italic: true))
                            .tracking(-1)
                            .foregroundStyle(OMColor.plum)
                            .opacity(reveal(at: 1))
                            .offset(y: reveal(at: 1) > 0 ? 0 : 6)
                        VStack(spacing: 4) {
                            Text("welcome.kicker.line1")
                            Text("welcome.kicker.line2")
                            Text("welcome.kicker.line3")
                        }
                        .multilineTextAlignment(.center)
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)
                        .opacity(reveal(at: 2))

                        VStack(spacing: 12) {
                            TextField(String(localized: "welcome.invite.placeholder"), text: $inviteCode)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled(true)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityHint(Text("welcome.invite.hint"))
                            TextField(String(localized: "welcome.email.placeholder"), text: $email)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .textFieldStyle(.roundedBorder)
                            Button { Task { await startEmail() } } label: {
                                Text("welcome.continue.button")
                            }
                                .buttonStyle(OMPrimaryButtonStyle())
                                .disabled(email.isEmpty || loading)

                            if challengeId != nil {
                                // SEV-M15 — Render the verification
                                // code through `SecureField` so the
                                // dev token auto-filled in non-prod
                                // builds isn't shoulder-surfable. Real
                                // users still tap-paste the 6-digit
                                // code; SecureField hides the glyphs
                                // either way.
                                SecureField(String(localized: "welcome.verify.placeholder"), text: $token)
                                    .textFieldStyle(.roundedBorder)
                                Button { Task { await verify() } } label: {
                                    Text("welcome.verify.button")
                                }
                                    .buttonStyle(OMPrimaryButtonStyle())
                                    .disabled(token.isEmpty)
                            }

                            HStack(spacing: 10) {
                                Rectangle().fill(OMColor.divider).frame(height: 1)
                                Text("welcome.separator")
                                    .font(OMFont.caption)
                                    .foregroundStyle(OMColor.inkMuted)
                                Rectangle().fill(OMColor.divider).frame(height: 1)
                            }
                            .padding(.vertical, 4)

                            Button {
                                Task { await appleLogin() }
                            } label: {
                                Label {
                                    Text("welcome.apple.button")
                                } icon: {
                                    Image(systemName: "applelogo")
                                }
                            }
                            .buttonStyle(OMSecondaryButtonStyle())
                            .disabled(loading)
                        }
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                        .opacity(reveal(at: 3))

                        // SEV-M4 — The Developer-login disclosure is a
                        // pure local-dev convenience and must not ship
                        // in TestFlight / App Store builds. Compile-time
                        // gated so the strings are not present in
                        // Release-binary stringification.
                        #if DEBUG
                        DisclosureGroup(String(localized: "welcome.dev.disclosure")) {
                            VStack(spacing: 8) {
                                TextField(String(localized: "welcome.dev.user_id.placeholder"), text: $devUserId)
                                    .textFieldStyle(.roundedBorder)
                                Button { Task { await devLogin() } } label: {
                                    Text("welcome.dev.button")
                                }
                                    .buttonStyle(OMGhostButtonStyle())
                            }
                            .padding(.top, 8)
                        }
                        .font(OMFont.caption)
                        .foregroundStyle(OMColor.inkMuted)
                        .padding(.horizontal, 24)
                        .opacity(reveal(at: 4))
                        #endif

                        HStack(spacing: 16) {
                            Link(String(localized: "welcome.footer.privacy"), destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/privacy/principles.md")!)
                            Link(String(localized: "welcome.footer.safety"), destination: URL(string: "https://github.com/cheesejaguar/openmatch/blob/main/docs/safety/community-guidelines.md")!)
                            Link(String(localized: "welcome.footer.source"), destination: URL(string: "https://github.com/cheesejaguar/openmatch")!)
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
            .alert(Text("welcome.signin_error.alert.title"), isPresented: .init(
                get: { error != nil },
                set: { _ in error = nil }
            )) {
                Button(role: .cancel) {} label: { Text("common.ok") }
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
            // SEV-M15 — Only auto-fill the dev token into the
            // verification field in DEBUG builds. In Release the
            // backend should never emit `devToken`, but belt-and-braces
            // gating means a misconfigured `NODE_ENV` on a staging
            // TestFlight build still doesn't pre-populate the field.
            #if DEBUG
            if let dev = r.devToken { token = dev }
            #endif
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

    // SEV-M4 — The dev-login call site is wrapped in `#if DEBUG`
    // alongside its UI. Defining the method itself only in DEBUG removes
    // the symbol from the Release binary; the `devLogin` API on
    // APIClient stays callable so tests can still exercise it, but
    // there is no Welcome-view code path that calls it in shipped
    // builds.
    #if DEBUG
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
    #endif

    // Maps backend invite-gate errors to user-readable copy. The
    // typed APIError cases below come from the central registry in
    // `backend/src/lib/error-codes.ts`; unrecognised errors fall back
    // to the localised description that APIError.errorDescription
    // produces from the .strings bundle.
    private func mapInviteError(from error: Error) -> String {
        // Copy mirrors backend invite-gate codes. Keys live in
        // Localizable.strings under welcome.invite.* so they're
        // localizable per the i18n scaffolding doc.
        if let apiError = error as? APIError {
            switch apiError {
            case .inviteRequired:
                return String(localized: "welcome.invite.required")
            case .inviteInvalid:
                return String(localized: "welcome.invite.invalid")
            case .inviteExhausted:
                return String(localized: "welcome.invite.exhausted")
            case .inviteExpired:
                return String(localized: "welcome.invite.expired")
            case .inviteRevoked:
                return String(localized: "welcome.invite.revoked")
            case .signupsPaused:
                return String(localized: "welcome.signups_paused")
            case .outsideMetro:
                return apiError.errorDescription ?? String(localized: "welcome.outside_metro")
            case .countryNotSupported:
                return apiError.errorDescription ?? String(localized: "welcome.country_not_supported")
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
