import Foundation
import CryptoKit
import Security

// SEV-M2 — Optional SPKI (SubjectPublicKeyInfo) pinning for the
// backend's `URLSession`.
//
// Behaviour:
//   - When `OMBackendSPKIPins` in Info.plist is absent or empty, the
//     delegate falls through to the default system-trust evaluation —
//     i.e. ships the same TLS posture as before. This is the default for
//     Wave 2 because the backend is hosted on a rotating Vercel preview
//     hostname; baking a leaf SPKI into the binary would brick the app
//     on the next renewal. See `doc/security/cert-pinning-design.md`.
//   - When the pin list is non-empty, the delegate computes
//     `sha256(SPKI-DER)` of the leaf certificate and only accepts the
//     connection if the result matches one of the base64-encoded pins.
//     Ship at least two pins (current + backup) so a single key rotation
//     doesn't brick the app.
//
// This file is deliberately small and dependency-free so the test target
// can verify the hash computation without spinning up a TLS server.
enum CertPinning {
    /// Info.plist key holding the base64-encoded SHA-256 SPKI pins.
    static let infoPlistKey = "OMBackendSPKIPins"

    /// Loaded pin set. Empty on default builds.
    static var configuredPins: Set<String> {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) else { return [] }
        if let array = raw as? [String] {
            return Set(array.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
        }
        if let single = raw as? String, !single.isEmpty {
            return [single]
        }
        return []
    }

    /// Compute the base64-encoded SHA-256 of a certificate's SPKI (DER).
    /// Returns nil if the certificate's public-key data can't be extracted.
    static func spkiHash(for certificate: SecCertificate) -> String? {
        guard let publicKey = SecCertificateCopyKey(certificate) else { return nil }
        var error: Unmanaged<CFError>?
        guard let der = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            return nil
        }
        // SecKeyCopyExternalRepresentation returns the raw key bytes
        // (modulus + exponent for RSA, or X9.63 for EC). For pin
        // comparison we want the SubjectPublicKeyInfo encoding, which
        // includes the algorithm identifier. Most pinning tooling
        // computes SPKI by extracting from the cert directly:
        //
        //   openssl x509 -pubkey -noout < cert.pem
        //     | openssl pkey -pubin -outform DER
        //     | openssl dgst -sha256 -binary | base64
        //
        // SecCertificateCopyKey + SecKeyCopyExternalRepresentation give
        // us the bare key, not the SPKI. To match the openssl flow we
        // wrap the key in the standard SPKI prefix for the algorithm.
        let prefixed = Self.spkiPrefixedKey(publicKey: publicKey, keyData: der) ?? der
        let digest = SHA256.hash(data: prefixed)
        return Data(digest).base64EncodedString()
    }

    /// Verify that the server-trust's leaf certificate matches one of the
    /// configured pins. Returns true if the trust evaluates AND the pin
    /// check passes. Returns true with no enforcement when the pin set
    /// is empty (default).
    static func evaluate(serverTrust: SecTrust) -> Bool {
        let pins = configuredPins
        if pins.isEmpty {
            // No pins → fall back to system trust evaluation only.
            var err: CFError?
            return SecTrustEvaluateWithError(serverTrust, &err)
        }
        // Require system trust to pass first; pinning is *additional*.
        var err: CFError?
        guard SecTrustEvaluateWithError(serverTrust, &err) else { return false }
        guard let chain = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate],
              let leaf = chain.first else {
            return false
        }
        guard let hash = spkiHash(for: leaf) else { return false }
        return pins.contains(hash)
    }

    // MARK: - SPKI wrapping

    // Standard SubjectPublicKeyInfo DER prefixes for the algorithms iOS
    // backends realistically present. The full SPKI = prefix || keyData.
    // These are well-known constants documented by RFC 5280 + PKCS#1 /
    // ANSI X9.63. We pick the prefix based on attributes of the SecKey.
    private static let rsa2048SPKIHeader: [UInt8] = [
        0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09,
        0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
        0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00,
    ]
    private static let rsa4096SPKIHeader: [UInt8] = [
        0x30, 0x82, 0x02, 0x22, 0x30, 0x0d, 0x06, 0x09,
        0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
        0x01, 0x05, 0x00, 0x03, 0x82, 0x02, 0x0f, 0x00,
    ]
    private static let ecP256SPKIHeader: [UInt8] = [
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
        0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
        0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
        0x42, 0x00,
    ]

    private static func spkiPrefixedKey(publicKey: SecKey, keyData: Data) -> Data? {
        guard let attrs = SecKeyCopyAttributes(publicKey) as? [String: Any] else { return nil }
        let type = attrs[kSecAttrKeyType as String] as? String
        let size = (attrs[kSecAttrKeySizeInBits as String] as? Int) ?? 0
        let header: [UInt8]?
        if type == (kSecAttrKeyTypeRSA as String) {
            if size <= 2048 { header = rsa2048SPKIHeader } else { header = rsa4096SPKIHeader }
        } else if type == (kSecAttrKeyTypeECSECPrimeRandom as String) {
            // Most server EC keys today are P-256; P-384 has a different
            // header. We only handle P-256 here; callers can extend the
            // table if production switches.
            if size == 256 { header = ecP256SPKIHeader } else { header = nil }
        } else {
            header = nil
        }
        guard let header else { return nil }
        var out = Data(header)
        out.append(keyData)
        return out
    }
}

// URLSessionDelegate that defers to `CertPinning.evaluate`. Held by
// `APIClient`'s URLSession. Strong-references on the session are owned
// by URLSession itself.
final class PinningSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        if CertPinning.evaluate(serverTrust: trust) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
