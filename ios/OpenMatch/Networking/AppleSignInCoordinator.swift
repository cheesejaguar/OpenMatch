import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

// SEV-M5 — Sign-in-with-Apple replay-binding.
//
// Apple's SIWA recommends a per-request nonce: client generates a fresh
// random `rawNonce`, sets `request.nonce = SHA256(rawNonce)`, then sends
// both the identity token *and* `rawNonce` to the backend. The backend
// re-hashes `rawNonce` and compares against the `nonce` claim baked into
// the identity-token JWT by Apple. That binding makes a captured
// identity token replay-resistant — an attacker without the corresponding
// `rawNonce` can't satisfy the backend's nonce check even within Apple's
// 10-minute token validity window.
//
// Server-side verification of the nonce belongs to the SIWA-server lane
// (see `backend/src/services/apple-auth.service.ts`). This file only
// produces the nonce and exposes it to the caller; the iOS half has no
// way to validate the JWT itself.
//
// Wraps ASAuthorizationController in an async API. The coordinator must
// be retained by the caller for the duration of the request — the
// system holds only a weak reference to the delegate.
final class AppleSignInCoordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    // SIWA result paired with the *unhashed* nonce so the caller can
    // POST both to the backend.
    struct Result {
        let identityToken: String
        // Raw (unhashed) nonce. The backend re-hashes this with SHA-256
        // and compares against the `nonce` claim in the identity token.
        let rawNonce: String
    }

    private var continuation: CheckedContinuation<Result, Error>?
    // Retained for the duration of a single sign-in ceremony so the
    // delegate callback can pair the identity token with the nonce that
    // was hashed into `request.nonce`.
    private var pendingRawNonce: String?

    enum AppleSignInError: Error, LocalizedError {
        case missingIdentityToken
        case cancelled
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .missingIdentityToken: return "Apple did not return an identity token."
            case .cancelled: return "Sign in was cancelled."
            case .failed(let reason): return reason
            }
        }
    }

    func signIn() async throws -> Result {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Result, Error>) in
            self.continuation = cont
            let rawNonce = Self.makeRawNonce()
            self.pendingRawNonce = rawNonce
            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.email]
            // Apple expects the *hashed* nonce on the request; the raw
            // nonce stays on-device until we POST it to the backend.
            request.nonce = Self.sha256Hex(rawNonce)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8),
              let rawNonce = pendingRawNonce else {
            continuation?.resume(throwing: AppleSignInError.missingIdentityToken)
            continuation = nil
            pendingRawNonce = nil
            return
        }
        continuation?.resume(returning: Result(identityToken: token, rawNonce: rawNonce))
        continuation = nil
        pendingRawNonce = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            continuation?.resume(throwing: AppleSignInError.cancelled)
        } else {
            continuation?.resume(throwing: AppleSignInError.failed(error.localizedDescription))
        }
        continuation = nil
        pendingRawNonce = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes
        for scene in scenes {
            if let windowScene = scene as? UIWindowScene,
               let window = windowScene.windows.first(where: { $0.isKeyWindow }) {
                return window
            }
        }
        return ASPresentationAnchor()
    }

    // MARK: - Nonce helpers (also exercised directly in tests)

    // 32 cryptographically random bytes, hex-encoded → 64-char string.
    // Hex (rather than base64) keeps the nonce trivially round-trippable
    // through JSON / URL components without escaping concerns.
    static func makeRawNonce(byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        if status != errSecSuccess {
            // SecRandom should never fail on a real device; fall back to
            // a UUID so we don't ship an empty nonce. UUIDs are 122 bits
            // of entropy — below CSPRNG strength but still acceptable for
            // this code path (which we don't expect to hit).
            return UUID().uuidString.replacingOccurrences(of: "-", with: "")
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    // SHA-256(rawNonce) as lowercase hex. Apple's verification expects
    // the same encoding on both sides (client hash and server JWT claim).
    static func sha256Hex(_ input: String) -> String {
        let data = Data(input.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
