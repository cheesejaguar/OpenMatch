# Security policy

OpenMatch handles sensitive user data — photos, location, messages, identity. We take security reports seriously.

## Reporting a vulnerability

**Do not** open a public issue. Use [GitHub's private security advisory](https://github.com/cheesejaguar/openmatch/security/advisories/new) on this repository — that's the canonical channel and reaches the maintainers directly. A dedicated email address will be published once the project has a custodial team to monitor it; until then, the GitHub advisory flow is the only supported reporting path.

Please include:

- A description of the issue and where you found it.
- Steps to reproduce, or a proof-of-concept.
- The impact you believe it has.
- Your contact information for follow-up.

We will acknowledge your report within **3 business days** and aim to ship a fix or a documented mitigation within **30 days** for high-severity issues.

## What's in scope

- The iOS app (`/ios`).
- The backend (`/backend`) deployed as Vercel Functions.
- The matching package (`/matching`).
- Deployment configuration (`vercel.json`, `.github/workflows/`) — only credential leakage or insecure defaults; deployment of customer-owned infra is the customer's responsibility.

Out of scope: third-party services (App Store, Vercel, Neon, Upstash, Ably), denial-of-service that requires unrealistic resources, social engineering of maintainers, and findings on outdated forks.

## Disclosure

We follow coordinated disclosure. Once a fix is shipped (or a mitigation is in place) we will:

- Publish a GitHub security advisory.
- Credit the reporter unless they prefer anonymity.
- Add an entry to the security section of `docs/`.

## Hardening already in place

- TLS for all network traffic.
- Short-lived JWT access tokens (15 min) with rotating refresh tokens (30 days, revoked on use).
- Tokens stored in iOS Keychain.
- Photos uploaded directly to Vercel Blob via one-shot, scoped, short-lived tokens — the API never proxies binary content.
- Location stored at PostGIS precision internally but only ever exposed as bucketed text ("8 miles away") to other users.
- Per-route rate limits on auth, swipes, messaging, blocks, and reports — backed by Upstash Redis so limits survive across stateless function invocations.
- Realtime chat tokens issued via Ably with capabilities scoped strictly to the caller's active conversations.
- Email magic-link tokens are 256-bit, single-use, expire in 15 minutes, and are stored hashed.
- No third-party advertising or cross-app tracking SDKs.
- Opportunistic cleanup of expired auth challenges and revoked sessions on every use.

See `docs/privacy/principles.md` for the privacy model and `docs/safety/community-guidelines.md` for the trust-and-safety policy.
