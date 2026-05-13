# OpenMatch Regulatory Landscape

> **Not legal advice.** This document is an engineering-oriented survey of laws, regulations, and platform rules that plausibly apply to OpenMatch as an 18+, swipe-based dating/social app distributed on iOS, with EU and US users. Before launch (or any material change in geography or feature set) the items here must be reviewed by qualified counsel in each operating jurisdiction.

OpenMatch is simultaneously three regulated things:

1. A **consumer dating service** (most jurisdictions treat dating apps as a distinct, higher-risk category of online intermediary).
2. A **social / interactive computer service** that hosts user-generated content (profiles, photos, messages).
3. A **processor of sensitive personal data** (sexual orientation, gender identity, precise geolocation, photographs, sometimes inferred health/relationship status).

The combination drives most of the obligations below.

---

## 1. Privacy and Data Protection

### 1.1 Cross-cutting principles every regime expects

- A lawful basis for each processing purpose (consent, contract, legitimate interest, legal obligation).
- A published, honest, jurisdiction-specific privacy notice.
- Data subject / consumer rights: access, correction, deletion, portability, restriction, objection.
- Data minimisation, purpose limitation, storage limitation, accuracy, integrity & confidentiality.
- A documented retention schedule.
- A breach notification process (regulator + affected users, time-boxed).
- A documented record of processing activities (RoPA / Art. 30 register).
- Vendor / sub-processor due diligence and contracts (DPA / SCCs).
- Cross-border transfer mechanism for each outbound flow.

### 1.2 European Economic Area / United Kingdom

| Instrument | Applies because | Practical asks |
|---|---|---|
| **GDPR (EU 2016/679)** | EU residents will be users; dating apps process Art. 9 "special category" data (sexual orientation, often health, sometimes ethnicity/religion). | Explicit consent for Art. 9 data; DPIA (Art. 35) — mandatory for large-scale profiling and special category data; appointment of EU representative (Art. 27) if no EU establishment; DPO likely required (Art. 37(1)(b)/(c)); 72-hour breach notification (Art. 33); SCCs + TIA for transfers (Schrems II). |
| **UK GDPR + Data Protection Act 2018** | Post-Brexit UK regime. | UK representative; ICO registration & fee; UK IDTA or Addendum for transfers. |
| **ePrivacy Directive 2002/58/EC** | Governs cookies, similar identifiers, push tokens, and electronic marketing. | Consent for non-essential storage/access on device; soft opt-in for transactional email; granular marketing consents. |
| **Digital Services Act (EU 2022/2065)** | OpenMatch is a "hosting service" and likely an "online platform". | Single point of contact + legal representative; clear terms; notice-and-action mechanism; statement of reasons to affected users (database upload); internal complaint-handling system; out-of-court dispute body; trusted flagger workflow; transparency report (yearly); ads transparency; recommender transparency (we already publish weights — keep that); protection of minors design duties; ban on dark patterns. |
| **Digital Markets Act** | Not currently a gatekeeper; monitor only. | None today. |
| **AI Act (EU 2024/1689)** | The matching algorithm is in scope as a "limited risk" recommender. If we add facial/biometric processing for verification, that crosses into high-risk. | Transparency obligations; if biometric verification used, conformity assessment + DPIA + provider obligations. |
| **NIS2 (EU 2022/2555)** | Likely **out of scope** for now (we're not "essential" or "important" by sector), but reassess at scale. | Monitor thresholds. |

### 1.3 United States

US privacy is a patchwork. Compliance must be implemented per-state plus federal sectorals.

| Instrument | Applies because | Practical asks |
|---|---|---|
| **CCPA / CPRA (California)** | California consumers. CPRA treats precise geolocation, sexual orientation, sex life, and account credentials as **Sensitive Personal Information (SPI)**. | "Do Not Sell or Share / Limit Use of My SPI" links; Global Privacy Control honoring; opt-in for under-16 sale/share (we won't have under-18 at all); 12-month look-back access; risk assessment + cybersecurity audit (CPPA regs); contracts with all service providers. |
| **Comprehensive state privacy laws** (VCDPA-VA, CPA-CO, CTDPA-CT, UCPA-UT, TDPSA-TX, MCDPA-MT, OCPA-OR, IDPA-IN, TIPA-TN, FDBR-FL, DPDPA-DE, NHDPA-NH, NJDPA-NJ, MDPA-MD, KCDPA-KY, IDPA-IA, MN, RI; growing list) | Residents of each state. Most treat sex life, sexual orientation, and precise geo as sensitive and require **opt-in** consent. | Universal opt-out signal; targeted advertising opt-out (N/A — we don't do TA); sensitive-data opt-in; data protection assessments; cure periods vary. |
| **Maryland Online Data Privacy Act (MODPA, 2025)** | Marylanders. Stricter than peers: data-minimisation duty independent of consent; bans selling sensitive data outright. | Hard limit on data collected to what is "reasonably necessary"; absolute ban on selling SPI; no targeted ads to under-18. |
| **HIPAA** | **Out of scope** — we are not a covered entity. | Avoid becoming one (don't accept STI test results into structured fields). |
| **GLBA, FCRA, FERPA** | Out of scope. | — |
| **COPPA (under-13)** | We forbid under-18. Still need actual-knowledge mitigations because minors do lie about age. | Age gate; on actual knowledge of under-13: immediate deletion + no further collection; verifiable parental consent **not** offered (we're 18+). |
| **State breach notification laws (50 states + DC, PR, USVI, Guam)** | All US users. | Notification matrix by state: timing (often "without unreasonable delay"; some 30/45/60-day caps), AG copy thresholds, content-of-notice rules, substitute-notice rules. |
| **FTC Act §5 (unfair/deceptive)** | Default federal consumer-protection backstop. | Promises in the privacy policy and marketing must match implementation. The FTC has specifically sued dating apps (Grindr, Match) for deceptive practices and data sharing. |
| **FTC Health Breach Notification Rule** | Triggered if we hold identifiable health data outside HIPAA. | Don't take structured health intake; if we ever do, comply. |
| **VPPA (Video Privacy Protection Act)** | If we surface video content tied to identity. | Avoid identified video viewing logs being shared with third parties. |
| **Wiretap Act + ECPA + state two-party consent (CA, IL, MA, MD, NV, PA, WA, FL, MT, NH, CT, OR, VT)** | Voice/video calls if we add them. | Get all-party consent for any recording; today, only text → low risk. |
| **CAN-SPAM** | Marketing email. | Working unsubscribe in every message; physical mailing address; honest "From" and subject. |
| **TCPA** | SMS OTPs and any SMS marketing. | Express consent for marketing SMS; transactional OTPs are permitted but must be limited to that purpose. |

### 1.4 Other key jurisdictions (only if we ship there)

| Country / region | Regime | Notable |
|---|---|---|
| Canada | PIPEDA + Quebec **Law 25** | Quebec requires a privacy officer named publicly, mandatory PIAs, and explicit consent for "sensitive" data; rights to data portability and de-indexing. |
| Brazil | **LGPD** | Mirrors GDPR; ANPD breach notice. |
| Australia | **Privacy Act 1988 (APPs)** + Online Safety Act 2021 | Mandatory data breach scheme; eSafety Commissioner takedown powers; Basic Online Safety Expectations. |
| New Zealand | Privacy Act 2020 | OPC notification of "notifiable privacy breaches". |
| Japan | **APPI** | Cross-border transfer notice; opt-out registration with PPC. |
| South Korea | PIPA | Strict consent + onward transfer rules; data residency pressure. |
| India | **DPDPA 2023** | Verifiable parental consent for under-18 (note: India sets the bar at under-18, not under-13). |
| Singapore | PDPA | DNC registry for SMS marketing. |
| South Africa | POPIA | Information Officer registration. |
| Switzerland | revFADP | EDOEB notification; similar to GDPR. |
| UAE / KSA / Egypt / Türkiye | Various PDPLs | **Special caution:** same-sex relationships are illegal or criminalised in some of these. Hosting and promoting same-sex matching may itself be unlawful. Geo-fence carefully or do not launch. |
| China | PIPL | Cross-border SCC filing; data localisation; **out of scope** for OpenMatch. |

### 1.5 Sensitive-data inventory we already create

The privacy principles doc lists these. For compliance, each must be tagged and gated:

- **Always sensitive everywhere:** sexual orientation, sex life, precise geolocation, biometric (if added), health (if added), ethnicity, religion, account credentials.
- **Sensitive in some regimes:** gender identity, immigration status, union membership.
- **Photo-derived:** face embeddings (BIPA in IL, TX CUBI, WA biometric law, etc.).
- **Inferred:** any score derived from the above inherits the same classification.

---

## 2. Children and Minors

We are 18+ and that is a strict, code-enforced floor. Even so:

- **COPPA** — if we ever know a user is under 13, immediate deletion plus no further collection. Document the workflow.
- **California Age-Appropriate Design Code Act (AB 2273)** — currently enjoined in part on First Amendment grounds; track litigation. If enforced, applies to services "likely to be accessed" by minors. Our 18+ floor + onboarding signal helps but does not eliminate risk.
- **UK Children's Code (Age Appropriate Design Code)** — ICO expects high-confidence age assurance for any service where children might end up.
- **EU DSA Art. 28** — protection of minors design duty.
- **State age-verification laws** (Texas SCOPE Act, Utah Social Media Regulation Act, Mississippi HB 1126, Louisiana, Arkansas, Ohio, Tennessee, Florida HB 3, NY SAFE for Kids Act) — these are mostly aimed at platforms permitting under-18 users. Because OpenMatch is **18+ only**, our compliance path is "robust age assurance at signup," not "minor-mode UX". Many of these laws are also under active First Amendment litigation; track status.
- **TAKE IT DOWN Act (US, 2025)** — 48-hour removal for NCII, including AI-generated; applies to any "covered platform" that hosts user content. Applies regardless of age but minors are a focal class.

Age assurance options, in increasing strength: self-attestation → date-of-birth check → device signal (Apple Declared Age Range API) → document/biometric verification (Yoti, Persona, Onfido, Veriff). The right answer is layered.

---

## 3. Dating-app-specific laws and bills

Dating apps are increasingly singled out:

- **Online Dating Safety Acts** at state level — versions exist or have been proposed in **New Jersey** (the original "Internet Dating Safety Act", 2007), **New York, Illinois, Texas, Virginia, Florida, Connecticut**. Common asks: safety-tips disclosure on the page where users join; criminal-background-check disclosure ("does NOT do background checks") if we don't; notification to a user when an account they communicated with was banned for fraud (the "fraud alert" duty); ID-verification badge rules.
- **Romance-scam disclosure** — FTC and several state AGs publish recommended consumer warnings; some are codified.
- **Auto-renewal / negative option** laws (California ARL, FTC Click-to-Cancel, EU CRD) — currently N/A because OpenMatch refuses to monetize via dating mechanics. Becomes relevant only if a non-dating subscription is ever introduced.

---

## 4. Online Safety, Intermediary Liability, and Content Moderation

| Instrument | Notes |
|---|---|
| **US §230 of the CDA** | Broad immunity for user content, but does **not** immunise federal criminal law, IP, ECPA, or sex-trafficking (FOSTA-SESTA, 18 USC 2421A). |
| **FOSTA-SESTA** | Creates state and federal liability for "knowingly facilitating" sex trafficking. Drives the no-solicitation rule in our community guidelines. |
| **18 USC 2258A (NCMEC reporting)** | Mandatory CSAM reporting to NCMEC's CyberTipline. We must register as an electronic service provider and have a reporting pipeline. |
| **EU DSA** (see §1.2) | Full content-moderation regime. |
| **UK Online Safety Act 2023** | Duties of care for illegal content + content harmful to children + (if categorised) priority content; risk assessment; safety duties; Ofcom-facing accountability; named senior manager liability. Dating apps fall under "user-to-user services". |
| **Ireland Online Safety and Media Regulation Act** | Coimisiún na Meán oversight; applies if Irish-established. |
| **Australia Online Safety Act 2021** | eSafety takedown powers; Basic Online Safety Expectations transparency. |
| **India IT Rules 2021** | Grievance Officer, takedown SLAs, traceability for messaging. |
| **Singapore Online Safety (Miscellaneous Amendments) Act** | IMDA takedown powers. |
| **Germany NetzDG** | Largely superseded by DSA but legacy reporting may persist. |
| **DMCA §512** | Designated agent registered with USCO; notice-and-takedown; repeat-infringer policy; counter-notice flow. |
| **EU Copyright Directive (Art. 17)** | If we ever cross UGC thresholds and host significant copyrighted media — currently low risk. |

### Image-based abuse and CSAM specifically

- **TAKE IT DOWN Act** (US): 48-hour NCII takedown SLA; covers synthetic/AI-generated; designated removal pathway.
- **STOP CSAM Act** (US, proposed): track.
- **EU CSA Regulation** (proposed): track; could impose detection obligations on messaging.
- **UK / state revenge-porn statutes**: criminal liability for individuals; platform liability under OSA.
- **Hash-matching**: we should adopt PhotoDNA (Microsoft) and/or NCMEC's industry hash sharing for known CSAM; Thorn's Safer for unknown CSAM detection if budget allows; StopNCII.org hash list for NCII.

---

## 5. Accessibility

| Instrument | Notes |
|---|---|
| **ADA Title III (US)** | Courts increasingly treat consumer mobile apps as places of public accommodation. Target WCAG 2.2 AA. |
| **Section 508** | Only binds federal agencies; aim for parity. |
| **European Accessibility Act (EU 2019/882)** | In force **28 June 2025** for consumer e-commerce/communications apps. Conformity to harmonised standards (EN 301 549) required. |
| **UK Equality Act 2010** + EHRC guidance | Reasonable adjustments; WCAG 2.2 AA practical baseline. |
| **CVAA (US)** | Telecom; relevant only if we add voice/video calling. |
| **AODA (Ontario)** | WCAG 2.0 AA; covers Ontario-facing services above small-business thresholds. |

OpenMatch already commits to "icons + labels everywhere", Reduce Motion respect, semantic colors, and accessible labels. That is the spine of WCAG conformance; it needs to be verified.

---

## 6. Non-discrimination

- **US Civil Rights Act / Unruh Civil Rights Act (CA) / state public-accommodation statutes** — generally allow user choice in dating preferences (Roommates.com line of cases), but **operator-side** discrimination in service provision (e.g., refusing accounts to a protected class, biased moderation outcomes) is unlawful.
- **UK Equality Act 2010** — protected characteristics; algorithmic outcomes should be auditable for indirect discrimination.
- **EU Race Equality Directive, Gender Goods & Services Directive** — service-provision non-discrimination.
- **State anti-discrimination laws** covering sexual orientation and gender identity (now in most states) — moderation policy must be content-neutral with respect to LGBTQ+ users.
- **Fair Housing / lending laws** — not applicable but mention because the algorithm fairness doc should explicitly disclaim that we don't make housing/credit/employment decisions.

Our algorithm fairness doc and "no hidden attractiveness score" rule already align here; the obligation is to keep weights free of proxies for protected characteristics and to be able to demonstrate that on audit.

---

## 7. Marketing, Notifications, and Consent

- **CAN-SPAM** (US): unsubscribe within 10 business days; physical postal address; truthful headers.
- **CASL** (Canada): express opt-in for commercial electronic messages; record consents.
- **TCPA** (US): SMS marketing requires prior express written consent; OTPs are transactional.
- **GDPR + ePrivacy** (EU/UK): opt-in for marketing; separate consents for email/SMS/push.
- **EU DSA / consumer law**: ban on dark patterns in consent and cancellation flows.
- **iOS App Tracking Transparency**: even if we don't track, we must declare; cross-app correlation requires ATT prompt + opt-in.
- **Apple Push Notification rules**: notifications must not be used for marketing without consent and must offer category-level opt-outs.

---

## 8. Platform Distribution (Apple App Store)

Independent of law, App Store Review Guidelines are contractually binding and operationally blocking:

- **Guideline 1.2** — UGC apps must have content filtering, user blocking, reporting with a method to contact, and a published EULA matching Apple's terms.
- **Guideline 1.6** — data security: secure handling of user data.
- **Guideline 4.5.4** — push notifications: not required for use, not for ads without consent.
- **Guideline 5.1** — privacy: Privacy Manifest (`PrivacyInfo.xcprivacy`), Privacy Nutrition Labels in App Store Connect, App Tracking Transparency, Sign in with Apple parity if any third-party SSO is offered, account-deletion in-app (mandatory since June 2022).
- **Guideline 5.1.2 (iv)** — "apps providing dating services… must include a privacy policy and a clear mechanism to report objectionable users/content; must remove offending users within 24 hours."
- **Required Reason API** — declare reasons for using `UserDefaults`, file timestamps, system boot time, disk space, active keyboard.
- **Age rating** — 17+ minimum for unrestricted web access and mature/suggestive themes; dating apps practically need 17+.

---

## 9. Security and Operational Compliance

- **State breach notification** (US, 50 states) — already covered above.
- **GDPR Art. 32 / UK DPA s.40** — appropriate technical/organisational measures; pseudonymisation where feasible; encryption in transit and at rest; testing/auditing.
- **SOC 2 Type II** — not legally required; expected by enterprise partners and useful evidence under "appropriate measures" duties.
- **ISO/IEC 27001 / 27701** — same; 27701 directly maps to GDPR.
- **PCI-DSS** — N/A (no payments).
- **NIST SSDF / SLSA** — software supply chain hygiene; matters for the open-source posture.
- **Export controls** — strong cryptography in iOS apps: TLS and AES are License Exception ENC; annual self-classification report to BIS may be required if we ever export non-standard crypto.
- **OFAC / sanctions** — block signups from sanctioned jurisdictions (Cuba, Iran, North Korea, Syria, occupied regions of Ukraine); record-keeping.
- **CFAA / Computer Misuse Act** — internal access controls and audit logs already in our moderation doc.

---

## 10. Algorithmic Accountability and Transparency

- **EU AI Act** (limited-risk recommender today; high-risk if biometric verification added) — transparency obligations are already met by publishing the algorithm.
- **EU DSA** — Art. 27 explanation of recommender; we already publish weights publicly.
- **California ADMT** (CPPA rulemaking, finalising) — automated decision-making transparency; opt-out for "significant decisions." Dating recommendations probably do not qualify as "significant," but track.
- **Colorado SB 24-205 / Texas TRAIGA** — algorithmic discrimination duties for "high-risk" systems; dating is not currently enumerated but is plausibly captured by future amendments.
- **NYC Local Law 144, Illinois AIVID** — employment-only; not applicable.

The "auditable algorithm" stance is a competitive advantage *and* a compliance asset. Keep it.

---

## 11. Open-Source and IP

- **Apache-2.0** — already the project license; honor `NOTICE`; patent grant.
- **Third-party dependencies** — license inventory required (Apache, MIT, BSD all compatible; AGPL components in a service would force code disclosure — avoid).
- **Trademark** — "OpenMatch" must be cleared (USPTO + EUIPO) before public launch; consider defensive registrations.
- **DMCA designated agent** — register with U.S. Copyright Office, $6 + renewal every 3 years.

---

## 12. Records, Retention, and Lawful Process

- **Documented retention schedule** keyed to each data class (auth, profile, messages, swipes, reports, moderation, logs, backups).
- **Litigation hold** procedure overriding automatic deletion.
- **Law enforcement response policy** — who can respond; minimum legal process required (subpoena vs warrant vs MLAT); user-notice policy unless gagged; emergency disclosure standards (18 USC 2702(b)(8)).
- **Transparency reports** — required by DSA, requested by users; publish counts of LE requests, content removals, appeals.

---

## 13. Highest-stakes traps specific to a dating app

These are the areas where dating apps most often get sued or fined:

1. **Sharing sensitive data with ad networks / analytics** — Grindr €6.5M (NPC, 2021), Grindr FTC settlement (2024) for sharing HIV status; multiple wiretap class actions (Meta Pixel, session replay) for transmitting sensitive on-site behavior. OpenMatch's no-third-party-SDK rule is the right answer; never weaken it.
2. **Auto-renewal dark patterns** — N/A here; do not introduce.
3. **Romance scams** — duty of care emerging; we should be able to demonstrate proactive scam-pattern detection and the "block scammer notification" feature in jurisdictions that require it.
4. **NCII / sextortion** — TAKE IT DOWN, OSA; we need a 48-hour-or-better takedown SLA, hash matching, and a victim-friendly reporting pathway that doesn't require victims to re-upload the image.
5. **Underage users on adult platforms** — even with an 18+ floor, gaps lead to enforcement. Layered age assurance is mandatory.
6. **Location leakage** — Grindr's trilateration disclosure is a classic precedent. Our `formatDistance` bucketing is the right answer; enforce it as a lint-time invariant.
7. **Discoverable/queryable PII via API** — many dating apps have leaked exact coordinates or photo URLs by exposing internal fields. Treat the public API surface as part of the privacy boundary, with automated tests asserting it.
8. **Hosting in jurisdictions hostile to LGBTQ+ users** — risk of legal compulsion to disclose user identity. Decide deliberately where the service is *available*, and where data is *stored* and *processed*.

---

## 14. Quick map: data class → top obligations

| Data class | GDPR | CCPA/CPRA | DSA/OSA | App Store |
|---|---|---|---|---|
| Email/phone (auth) | Art. 6(1)(b) contract | PI (not SPI) | Confidentiality | Privacy label "Contact Info" |
| DOB | Art. 6(1)(c) legal compliance (age) | PI | — | Privacy label "Other User Content" |
| Precise location | Art. 9 if reveals sensitive context | **SPI** | — | "Coarse Location" preferred |
| Sexual orientation | **Art. 9 — explicit consent** | **SPI** | — | "Sensitive Info" |
| Photos | Art. 6(1)(b); biometric if face vectors | PI (biometric → SPI) | NCII rules | "User Content" |
| Messages | Art. 6(1)(b); confidentiality | PI | DSA notice-and-action | "Messages" |
| Swipes / likes | Art. 6(1)(b) | PI | DSA Art. 27 (recommender) | — |
| Reports / safety | Art. 6(1)(f) legitimate interest | PI | DSA notice-and-action | — |
| IP / device | Art. 6(1)(f) | PI / SPI in some states if persistent | — | "Identifiers" |

---

## 15. Frameworks we should formally adopt

- **Privacy by Design (Cavoukian, recognised by GDPR Recital 78)**
- **NIST Privacy Framework** (governance baseline)
- **NIST CSF 2.0** (security baseline)
- **OWASP MASVS** for the iOS app
- **OWASP ASVS L2** for the API
- **ISO/IEC 27001 + 27701** (target, post-MVP)
- **SOC 2 Type II** (target, when there is a B2B story)
- **WCAG 2.2 AA** (accessibility baseline)
- **EN 301 549** (EAA conformance)
- **IEEE 7000-2021** (ethically aligned design — voluntary but aligns with the project ethos)
