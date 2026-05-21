# Privacy Policy — [COMPANY NAME]

> **TEMPLATE — NOT LEGAL ADVICE.** This document is a starting point
> for a fork of OpenMatch. Have a lawyer in your jurisdiction review
> it before you publish. Every `[PLACEHOLDER]` must be filled in or
> removed. Sections may need to be added or removed depending on
> where you operate (EU/UK → GDPR; California → CCPA/CPRA;
> Brazil → LGPD; etc.).

**Effective date:** [DATE]

[COMPANY NAME] ("we", "us", "our") operates [APP NAME] (the
"Service"). This policy explains what personal information we collect,
how we use it, who we share it with, and the rights you have over it.

## 1. Information we collect

We try to collect as little as we can while still running a useful
dating service.

**You give us, when you sign up and use the Service:**

- Email address (for sign-in via magic link or Sign in with Apple).
- Date of birth (to verify you're 18+).
- Profile fields you choose to fill in: display name, photos, bio, prompts, gender identity, sexuality, height, occupation, education, lifestyle preferences.
- Discovery preferences (age range, distance, gender of interest).
- Approximate location (see §2).
- Messages you send to your matches.
- Reports you file against other users.

**We collect automatically when you use the Service:**

- Device identifiers (a randomly-generated installation ID, not your IDFA — we do not use the Advertising Identifier).
- App version, operating system version, device model.
- Crash reports (via [CRASH-REPORTING PROVIDER, e.g. Sentry] — see §5).
- Aggregated, first-party usage analytics (counts, not per-user behavior).

**We do not collect:**

- Your contact list, photo library, calendar, or other on-device data unless you explicitly grant access through iOS permissions and import it (e.g. selecting a profile photo).
- Information from third-party tracking SDKs or advertising networks. We do not embed any.

## 2. Location

The Service shows you potential matches near you, which requires us
to know roughly where you are.

- We collect your **approximate** location when you grant the iOS Location permission.
- We store location at high precision internally (PostGIS geography) so we can rank candidates by distance.
- We **never** show your exact location to other users. Distance is bucketed (e.g. "8 miles away"); no map pin, no last-seen position, no precise coordinates.
- You can revoke location access in iOS Settings at any time, which limits discovery to your last-known approximate area until you re-enable it.

## 3. How we use your information

We use the information above to:

- Provide the Service: show you potential matches, deliver messages, send sign-in links.
- Keep the Service safe: detect spam, abuse, and fake accounts; investigate reports.
- Improve the Service: aggregate usage analytics, debug crashes, evaluate algorithm fairness on synthetic data.
- Comply with our legal obligations: respond to lawful requests, meet age-of-consent and platform-store requirements.

We **do not** use your information to:

- Sell or rent it to third parties.
- Build behavioral advertising profiles.
- Train AI models on your messages or photos.

## 4. The matching algorithm

The Service uses a published, open-source matching algorithm. Every
ranking factor, weight, and eligibility rule is documented at
[ALGORITHM-DOCS-URL] and served back from the live API. You can
inspect why any specific profile appears for you via the "Why am I
seeing this profile?" surface inside the app.

We do not maintain a hidden attractiveness score, an internal
desirability ranking, or any other undocumented factor that affects
who you see.

## 5. Who we share information with

We share information only as described here:

- **Other users.** Information you put on your public profile (display name, photos, bio, prompts, approximate distance) is visible to other users in discovery. Information you put in messages is visible to the recipient.
- **Service providers.** We rely on infrastructure providers to operate the Service. Each one only receives the data necessary to do its job:
  - [HOSTING PROVIDER, e.g. Vercel / your-own-cloud] — application hosting.
  - [DATABASE PROVIDER, e.g. Neon] — encrypted-at-rest Postgres for user records and messages.
  - [BLOB STORAGE, e.g. Vercel Blob] — photos. Photos are uploaded directly to the provider with a short-lived, scoped token — our application never relays binary content.
  - [REALTIME PROVIDER, e.g. Ably] — live chat fan-out. Tokens are capability-scoped to your active conversations only.
  - [EMAIL PROVIDER, e.g. Resend / Postmark] — magic-link sign-in email.
  - [CRASH-REPORTING PROVIDER, e.g. Sentry] — error traces. We scrub email addresses, IDs, and other PII from breadcrumbs before sending.
- **Legal compliance.** If we receive a lawful subpoena, warrant, or court order, we may disclose information to the extent legally required. We will challenge requests that we believe are overbroad. We publish a transparency report annually at [TRANSPARENCY-URL].
- **Business transfers.** If [COMPANY NAME] is acquired or merged, your information may transfer to the successor entity. The successor must abide by this policy until they publish an updated one and notify you.

## 6. Your rights

You have the following rights regardless of where you live:

- **Access.** You can export everything we have about you from Settings → Privacy → Export My Data. We deliver a machine-readable archive within [N] days.
- **Correction.** You can edit your profile, preferences, and messages directly in the app.
- **Deletion.** You can delete your account from Settings → Account → Delete Account. We honor deletion within [N] days. Backups containing your data are purged within [N] days after that.
- **Withdrawal of consent.** You can revoke iOS permissions (location, photos, notifications, camera) at any time from iOS Settings.
- **Objection / restriction.** You can pause discovery from Settings → Discovery while keeping your account. Email us at [PRIVACY-CONTACT-EMAIL] for anything more specific.
- **Portability.** The data export in §6.1 is portable in standard formats (JSON, JPEG).
- **No retaliation.** Exercising any of these rights will not result in a worse experience on the Service.

**EU / UK (GDPR / UK GDPR) residents:** the legal bases we rely on are:

- *Performance of a contract* — to provide the Service you signed up for.
- *Legitimate interests* — to keep the Service safe and to improve it, weighed against your rights.
- *Consent* — for optional features (e.g. push notifications, optional photo album access).
- *Legal obligation* — for age verification and lawful disclosure.

You can lodge a complaint with your supervisory authority. You can
also designate an authorized agent to act on your behalf.

**California residents (CCPA / CPRA):** we do not "sell" or "share"
your personal information as those terms are defined under the CCPA.
You have the right to know, delete, correct, and limit use of
sensitive personal information; see the bullets above. We do not
respond to Do Not Track signals because there is no consistent
industry standard, but we honor Global Privacy Control signals where
technically feasible.

## 7. Retention

- **Active accounts:** we keep your data while your account is active.
- **Deleted accounts:** we delete personal data within [N] days of deletion request.
- **Messages with deleted users:** messages you sent to a user who has since deleted their account are retained on your side until you delete the conversation. The deleted user's identity is replaced with a placeholder.
- **Reports:** we retain abuse reports and the associated content for [N] months to support enforcement and appeals.
- **Logs:** we retain access logs for [N] days for security analysis.

## 8. Security

We take security seriously, but no system is perfectly secure. Our
hardening includes:

- TLS for all network traffic.
- Short-lived JWT access tokens (15 min) with rotating refresh tokens (30 days, revoked on use).
- Tokens stored in the iOS Keychain.
- Photo uploads use one-shot, scoped, short-lived tokens — our application never proxies binary content.
- Per-route rate limits on authentication, swipes, messaging, and reports.
- Email magic-link tokens are 256-bit, single-use, and expire in 15 minutes.

To report a vulnerability, see [SECURITY-CONTACT-URL].

## 9. Children

The Service is not directed to children under 18. We do not knowingly
collect information from anyone under 18. If you believe we have, email
us at [PRIVACY-CONTACT-EMAIL] and we will delete the account.

## 10. International transfers

We are based in [JURISDICTION]. If you use the Service from elsewhere,
your information will be transferred to and processed in
[JURISDICTION]. Where required by law (EU/UK), we rely on Standard
Contractual Clauses or equivalent safeguards with our service
providers.

## 11. Changes to this policy

We will notify you of material changes via in-app notice or email at
least [N] days before they take effect. Continued use of the Service
after that date constitutes acceptance of the updated policy. The
prior version remains available at [POLICY-HISTORY-URL].

## 12. Contact

Privacy questions: [PRIVACY-CONTACT-EMAIL]
Security reports: [SECURITY-CONTACT-URL]
Postal: [POSTAL-ADDRESS]

EU/UK data protection representative: [REPRESENTATIVE-NAME-AND-ADDRESS, if applicable]
Data Protection Officer: [DPO-CONTACT, if applicable]
