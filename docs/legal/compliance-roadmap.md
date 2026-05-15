# OpenMatch Compliance Roadmap

> Companion to [`regulatory-landscape.md`](./regulatory-landscape.md). That document explains *what applies*; this document is the engineering plan for *getting there*. Each item below is meant to land as a tracked work-item in the issue tracker.
>
> **Not legal advice.** Every workstream listed here has a counsel-review checkpoint. Implementation can proceed in parallel, but no launch in a given jurisdiction happens before counsel sign-off for that jurisdiction.

## Operating assumptions

- Target launch geographies for MVP: **United States and European Economic Area + United Kingdom**. Other countries are explicitly out-of-scope at launch and must be geofenced (signup IP / Apple storefront / payment country gate).
- 18+ floor remains absolute.
- No monetization through dating mechanics remains absolute; this removes ~30% of the usual dating-app compliance burden (auto-renew, subscription cancel-flows, paid-feature consumer-fraud).
- Apple App Store is the only distribution channel.
- Production data stored in the United States today (Neon `iad1`). EU residency is a Phase 3 question.

---

## Phase 0 — Foundations (in flight)

Goal: make the project capable of holding a defensible compliance posture before we collect any real user data.

| # | Workstream | Concrete deliverable | Owner | Status |
|---|---|---|---|---|
| 0.1 | Branch / governance | `docs/legal/` exists; legal changes require CODEOWNERS review. | Eng + Founder | ✅ This branch |
| 0.2 | Data inventory | A machine-readable RoPA (`docs/legal/ropa.yaml`) listing every data class, purpose, lawful basis, retention, recipient, transfer mechanism. | Eng | ⬜ |
| 0.3 | Data-flow diagrams | Per-feature DFDs covering signup, swipe, match, chat, photo upload, report, export, delete. | Eng | ⬜ |
| 0.4 | Threat model | STRIDE pass per feature; LINDDUN pass for privacy threats. | Eng + Sec | ⬜ |
| 0.5 | Vendor register | List of every sub-processor (Neon, Vercel, Upstash, Ably, Vercel Blob, Apple, SMTP provider) with DPA links and transfer mechanism. | Eng | ⬜ |
| 0.6 | Counsel of record | Engage US privacy/T&S counsel + EU/UK counsel; appoint DPO/EU rep. | Founder | ⬜ |

Exit criteria: a single page that maps every byte of user data we plan to collect to a lawful basis, a retention window, a recipient list, and a deletion path.

---

## Phase 1 — Pre-launch baseline (must ship before first non-employee user)

Goal: be legally launchable in the US and EU/UK.

### 1.1 User-facing legal artifacts

- [ ] **Terms of Service** — UGC indemnity, EULA per Apple §1.2, arbitration (US) + small-claims carve-out, EU/UK consumer-rights compliant (no class-action waiver enforceable in EU), DSA single point of contact, illegal-content reporting address.
- [ ] **Privacy Notice** — layered: short notice in onboarding, full notice on web. Per-jurisdiction supplements (CCPA "Notice at Collection", "Right to Know / Delete / Correct / Limit Use of SPI" page; EU/UK transfers; Quebec officer; Brazil controller).
- [ ] **Cookie / SDK notice** — even with no third-party SDKs, document analytics + app-storage usage; ePrivacy banner only on web; iOS uses ATT.
- [ ] **Community Guidelines** — already drafted; cross-link from app and web.
- [ ] **Children's policy** — under-13 deletion workflow + statement.
- [ ] **DMCA / IP policy** — designated agent + email/postal mailbox; counter-notice flow.
- [ ] **Law-enforcement guidelines** — public page describing acceptable process.
- [ ] **Accessibility statement** — WCAG 2.2 AA conformance claim + contact for inaccessible content.
- [ ] **Transparency-report template** — DSA-shaped, even before first publication is due.

### 1.2 Consent and rights infrastructure

- [ ] **Consent service** in the backend: versioned consents for Art. 9 (sexual orientation, etc.), marketing, transactional comms, location precision. Store `policy_version`, `accepted_at`, `text_hash`.
- [ ] **DSAR pipeline**: in-app "Download my data" + "Delete my account". Service-side worker that materialises the export bundle (JSON + photos) within 30 days (GDPR) / 45 days (CCPA), with extension logic.
- [ ] **Correction / restriction**: every profile field already editable; add an explicit "restrict processing" toggle that pauses non-essential processing.
- [ ] **Global Privacy Control** honoring on the web property.
- [ ] **Right-to-object** to legitimate-interest processing (analytics, anti-fraud) where applicable.
- [ ] **Records of every rights request** — for audit.

### 1.3 Age assurance

- [ ] Strong age gate at signup (date-picker, not "I am 18+").
- [ ] **Apple Declared Age Range API** integration (where available).
- [ ] Layered escalation: re-prompt + document/selfie verification when age is contested by signal (photo classifier flag, report, behavioural).
- [ ] Vendor short-list for ID/age verification: Persona, Yoti, Onfido, Veriff. Selection criterion: data minimisation (no retained PII beyond a token), BIPA-safe in Illinois, EU DPA-friendly.
- [ ] On any actual-knowledge under-18 signal: immediate suspension + deletion workflow with a 72-hour audit log.

### 1.4 Safety and content moderation

- [ ] **Notice-and-action** endpoint (DSA Art. 16) for any user or non-user to report illegal content; structured form; auto-acknowledgement; SLA timer.
- [ ] **Statement-of-reasons** generation for every moderation action; submission to the DSA Transparency Database (Commission API).
- [ ] **Internal complaint-handling** (DSA Art. 20) — appeals queue, distinct reviewer, 30-day window.
- [ ] **Out-of-court dispute settlement** link (DSA Art. 21) — point to a certified body per Member State once available.
- [ ] **Trusted-flagger** intake email + SLA.
- [ ] **NCMEC / CyberTipline** registration (18 USC 2258A); reporting pipeline; preservation of evidence.
- [ ] **PhotoDNA** hash matching for known CSAM; **StopNCII.org** hash list for NCII; configurable thresholds; human-in-the-loop review for hash hits.
- [ ] **TAKE IT DOWN Act** compliance: dedicated NCII reporting form usable by non-users; 48-hour SLA; no requirement to re-upload the image.
- [ ] **Ban-evasion** detection (device, IP, Apple subject reuse) consistent with Apple privacy rules.
- [ ] **Scammer-notification feature** ("an account you communicated with was banned for fraud") — required by some state online-dating-safety laws.
- [ ] **Safety center** in-app with crisis resources keyed to user's region.

### 1.5 Privacy / security engineering

- [ ] **`formatDistance` invariant test** — CI test that fails the build if any API response exposes raw lat/long to a non-owner.
- [ ] **PII tagging** — every Prisma column annotated with a sensitivity class; automated scan that any new column has an annotation.
- [ ] **Field-level encryption** for highest-risk columns (DOB, government-ID tokens if added) with KMS-backed keys.
- [ ] **TLS everywhere** (already), HSTS, modern cipher suites only.
- [ ] **Photo EXIF stripping** on upload (verify); re-encode to a normalized format.
- [ ] **Push notification content policy** — full / sender-only / hidden, already in privacy principles; enforce in iOS.
- [ ] **Authentication hardening** — rate limit, leaked-password check, refresh-token rotation, device-session list with revoke.
- [ ] **Audit logging** for any moderator action that touches private data; logs themselves are private and tamper-evident.
- [ ] **Backups** with separately enforced retention windows that match (not exceed) production retention.
- [ ] **Breach response runbook** with notification matrix per state and 72h GDPR timer; PR template for affected-user notice.

### 1.6 Apple App Store readiness

- [ ] In-app account deletion (Apple-mandated since iOS 17).
- [ ] Privacy Manifest (`PrivacyInfo.xcprivacy`) with Required Reason API declarations.
- [ ] Privacy Nutrition Labels in App Store Connect mirror reality.
- [ ] Sign in with Apple offered alongside any other third-party SSO.
- [ ] App age rating 17+.
- [ ] §1.2 UGC checklist: filter, block, report-with-contact, EULA published.
- [ ] Push notification justification matches §4.5.4.

### 1.7 Marketing and comms

- [ ] CAN-SPAM-compliant footer in every email.
- [ ] Quarterly suppression-list testing.
- [ ] CASL records-of-consent for Canadian recipients.
- [ ] Granular notification preferences in-app (matches, messages, likes, safety, product news — last one off by default).

### 1.8 Sanctions and access control

- [ ] OFAC-list screening at signup (country + sanctioned-individuals where feasible).
- [ ] Geo-block sanctioned countries entirely.
- [ ] Block countries where same-sex matching is criminalised, or hard-disable orientation features in those locales — decision required.

### 1.9 Open-source compliance

- [ ] License inventory (SPDX) checked in CI; reject incompatible licenses (AGPL).
- [ ] CLA or DCO for external contributors (decision required).
- [ ] Trademark clearance for "OpenMatch" before public launch.

**Phase 1 exit criteria:** outside counsel signs off on (a) privacy-notice / consent flow, (b) DSAR pipeline, (c) NCII / CSAM pipeline, (d) DSA notice-and-action + statement-of-reasons, (e) App Store submission package.

---

## Phase 2 — First 12 months post-launch

Goal: prove compliance under load and close the gaps that only become real with traffic.

### 2.1 Transparency and reporting

- [ ] Publish first **DSA transparency report** by the statutory deadline.
- [ ] Publish first **OpenMatch transparency report** (broader: reports received, actions taken by category, response-time medians, appeals outcomes, LE requests).
- [ ] Submit statement-of-reasons to the **DSA Transparency Database** continuously.
- [ ] Average-monthly-active-users (AMAR) calculation published; if it crosses 45M, prepare for VLOP designation.

### 2.2 Algorithm transparency operationalised

- [ ] Continue publishing weights at `GET /api/v1/transparency/algorithm/current` (existing).
- [ ] Add **per-user explanation** ("Why am I seeing this profile?") backed by the same JSON.
- [ ] **Recommender opt-out**: under DSA Art. 38 for VLOPs, must offer a non-personalised feed; provide it pre-emptively as a "random / recent" option.
- [ ] **Fairness audit** annually: synthetic-cohort test that demographic membership alone never shifts ranking beyond a documented tolerance.
- [ ] DPIA refresh annually and on material change.

### 2.3 Security certifications

- [ ] **SOC 2 Type II** (12-month observation window — start the clock at launch).
- [ ] **ISO/IEC 27001** target audit at month 12.
- [ ] **ISO/IEC 27701** as 27001 extension to evidence GDPR compliance.
- [ ] **Penetration test** annually + on major release; report summary published.
- [ ] **Bug bounty** via HackerOne / Bugcrowd / direct; safe-harbor language in `SECURITY.md`.

### 2.4 Vendor and transfer governance

- [ ] **SCCs + Transfer Impact Assessment** for every EU→US transfer; refresh when EU-US DPF status changes.
- [ ] **UK IDTA / Addendum** for every UK→US transfer.
- [ ] Quarterly **sub-processor review** and 30-day notice of changes published.
- [ ] **EU data-residency option** investigation: Neon EU region, Upstash EU, Vercel EU; decision before Phase 3.

### 2.5 Accessibility

- [ ] WCAG 2.2 AA conformance audit by a third party.
- [ ] EAA conformity declaration (EU 2019/882, effective 28 June 2025).
- [ ] Accessibility statement updated with audit results.

### 2.6 State-by-state US

- [ ] **State privacy law engine**: a single policy table that turns each state's residency into the right banner, opt-out link, sensitive-data treatment, and AG-notice trigger.
- [ ] **Universal Opt-Out Signal** (GPC) honored on web; consider in-app surface.
- [ ] **Maryland MODPA** "reasonably necessary" data-minimisation review.

### 2.7 Romance-scam / fraud

- [ ] Tunable detection for known scam patterns: rapid off-platform push, geographic mismatch, photo reuse (reverse-image), language-model-generated bios.
- [ ] **"Account banned for fraud"** notification feature to anyone who recently messaged that account (state-law compliant; user-tested for victim-empathy).
- [ ] Public scam-awareness page; surface during onboarding.

---

## Phase 3 — Expansion (only after Phase 2 stabilizes)

### 3.1 New geographies

Each new country requires its own gating decision, counsel review, and at minimum:
- Privacy notice supplement.
- Local representative if required (e.g., LGPD, APPI).
- Local content-moderation contact / grievance officer if required (India IT Rules, Australia OSA).
- Tax/VAT registration if any paid feature is ever introduced.
- Decision on data residency.

### 3.2 New feature gates that re-open compliance

| Feature | Triggers |
|---|---|
| Voice / video calling | Wiretap consent; CVAA; ECPA; storage of recordings raises new Art. 9 concerns. |
| Biometric verification | BIPA / TX CUBI / WA biometric; AI Act high-risk; explicit consent. |
| ML-based ranking | DPIA refresh; AI Act transparency; bias audit; documentation update. |
| Any paid feature | App Store IAP, auto-renewal laws, FTC click-to-cancel, EU CRD. |
| Group chats / public surfaces | DSA "very large platform" risk thresholds approach faster. |
| Web product surface | ePrivacy/cookie consent, ADA web, EAA conformance. |
| Linking to external content / commerce | Marketplace rules (DSA), affiliate disclosures (FTC). |
| Health / wellness fields (STI status, etc.) | HIPAA-adjacent risk, FTC Health Breach Rule, GDPR Art. 9. |

Each of these requires re-opening this roadmap before merging.

---

## How to keep this honest

1. **Issue tracking** — every checkbox here is mirrored as a GitHub issue with a `legal/` label. The aggregate count is published in the transparency report.
2. **CODEOWNERS** — `docs/legal/` requires founder + counsel-of-record review on every change.
3. **Compliance review gate in CI** — a label `compliance-review-needed` is auto-applied to PRs that touch sensitive paths (privacy-related code, data models, auth, moderation, exports). Such PRs may not merge without an explicit reviewer ack.
4. **Quarterly compliance review** — calendar invite; walk the regulatory-landscape doc, refresh dates, list new bills/regulations, close or open issues accordingly.
5. **Annual DPIA / risk assessment** — refreshed each year and on every material change.
6. **Counsel checkpoints** — Phase exits explicitly require counsel sign-off; without it, the phase is not done.

---

## What we are explicitly *not* doing (and the legal upside)

- **No third-party ad SDKs** — eliminates the single largest class of dating-app privacy enforcement (FTC vs. Grindr/Match-style cases).
- **No paid boosts / super likes / subscription tier** — eliminates auto-renewal, dark-pattern, and price-discrimination enforcement risk.
- **No hidden attractiveness score** — eliminates a documented class of algorithmic-discrimination litigation.
- **No exact-location surfacing** — eliminates the Grindr-trilateration class of incidents.
- **No cross-app tracking / IDFA** — eliminates ATT enforcement risk and a class of state-law SPI obligations.

These constraints are an asset, not a cost. They should be defended in PR review with the same rigour as a passing test suite.
