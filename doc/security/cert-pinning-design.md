# iOS certificate pinning — design + Wave-2 status

Audit finding: `SEV-M2` (`doc/security/audit-mobile-privacy.md:51-78`).

## Wave-2 decision: ship scaffold, defer enforcement

A two-pin enforcement implementation against the Vercel-hosted backend
(`openmatch-backend-cheesejaguar-…vercel.app`) was prototyped and rejected
for this wave for three reasons:

1. **Vercel preview hostnames rotate their leaf cert chain on every
   redeploy.** Production also rotates on a faster cadence than any
   release-train we can pre-bake pins into. A hardcoded SPKI pin in the
   shipped binary would brick the app on the next renewal.
2. **Ably (`ably-cocoa`) and Sentry (`sentry-cocoa`) do not expose a
   `URLSessionDelegate` hook cleanly.** Ably uses an internal `WebSocket`
   wrapper that takes an opaque `ARTClientOptions`; there is no public
   delegate-injection seam. Sentry's transport is internal. Adding our
   own pins to those endpoints would require forking and is out of scope
   for Wave-2.
3. **The risk model.** ATS is already enforced (no
   `NSAppTransportSecurity` overrides; confirmed in `ios/project.yml`).
   The exploit path requires installing an attacker-controlled root CA
   on the device — which means either a malicious MDM profile (already
   game-over for a dating app) or the user actively accepting an
   untrusted cert prompt. Pinning is hardening against an attacker who
   already has on-device write access; it is not a primary control.

## What Wave-2 ships

A `URLSessionDelegate` is now attached to the `APIClient`'s `URLSession`
that:
- Reads SPKI pins from `Info.plist` key `OMBackendSPKIPins` (array of
  base64-encoded SHA-256 hashes of the leaf SPKI).
- When the array is empty (current default) the delegate falls through
  to system trust — i.e. ships exactly the same behaviour as today.
- When the array is non-empty, the delegate computes the SHA-256 of the
  server's leaf SubjectPublicKeyInfo and rejects the connection unless
  it matches one of the pins.

This is the "pinning rails" — the code path is exercised in tests so it
won't bit-rot, but enforcement is off until the operational story for
key rotation is figured out (likely: SPKI of the long-lived Vercel
custom-domain Edge cert, plus a backup pin).

## How to enable

1. Switch the backend off the preview-style Vercel URL onto a custom
   domain (`api.openmatch.app`) where we own the cert authority chain.
2. Generate two pins:
   ```bash
   openssl s_client -servername api.openmatch.app -connect api.openmatch.app:443 < /dev/null 2>/dev/null \
     | openssl x509 -pubkey -noout \
     | openssl pkey -pubin -outform DER \
     | openssl dgst -sha256 -binary \
     | base64
   ```
   Then a second pin for a backup key generated offline and held in a
   sealed envelope.
3. Add both pins to `ios/project.yml` under `OMBackendSPKIPins`.
4. Re-cut a TestFlight build, validate, then promote to prod.

## Out-of-scope

- Pinning the Ably WebSocket — defer until ably-cocoa exposes a
  delegate. Tracked as a future SDK request.
- Pinning Sentry — defer; the data Sentry sees is already scrubbed by
  `beforeSend` (PRs #48–#52) so the marginal protection is limited.
