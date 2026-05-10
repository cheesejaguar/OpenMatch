# Security policy

OpenMatch handles sensitive user data — photos, location, messages, identity. We take security reports seriously.

## Reporting a vulnerability

**Do not** open a public issue. Send a report to **security@openmatch.example** (replace with the project's real address before public launch) or use GitHub's private security advisory feature on this repository.

Please include:

- A description of the issue and where you found it.
- Steps to reproduce, or a proof-of-concept.
- The impact you believe it has.
- Your contact information for follow-up.

We will acknowledge your report within **3 business days** and aim to ship a fix or a documented mitigation within **30 days** for high-severity issues.

## What's in scope

- The iOS app (`/ios`).
- The backend (`/backend`).
- The matching package (`/matching`).
- Infrastructure-as-code (`/infra`) — only credential leakage or insecure defaults; deployment of customer-owned infra is the customer's responsibility.

Out of scope: third-party services (App Store, GCP), denial-of-service that requires unrealistic resources, social engineering of maintainers, and findings on outdated forks.

## Disclosure

We follow coordinated disclosure. Once a fix is shipped (or a mitigation is in place) we will:

- Publish a GitHub security advisory.
- Credit the reporter unless they prefer anonymity.
- Add an entry to the security section of `docs/`.

## Hardening already in place

- TLS for all network traffic.
- Short-lived JWT access tokens with rotating refresh tokens.
- Tokens stored in iOS Keychain.
- Photos served via signed, expiring URLs.
- Location stored at PostGIS precision internally but only ever exposed as bucketed text ("8 miles away") to other users.
- Rate limits on likes, messages, and authentication endpoints.
- No third-party advertising or cross-app tracking SDKs.
- Moderator access to private data is logged and requires a justification.

See `docs/privacy/principles.md` for the privacy model and `docs/safety/community-guidelines.md` for the trust-and-safety policy.
