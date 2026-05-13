# OpenMatch Privacy Notice

> **Draft / not yet legal advice.** Layered notice — short summary first, full notice second, jurisdictional supplements last. The implementation pairs this with versioned consent records (`ConsentRecord`) so we can prove what was shown to a user, when.

**Last updated:** 2026-05-13
**Effective:** [insert launch date]

---

## At a glance

We collect what we need to run a dating app safely and nothing more:

- Your **profile** (name, age, photos, what you're looking for).
- Your **device location**, used for distance — never shown precisely to other users.
- Your **messages** with matches.
- Operational signals (sign-in, IP, device token, reports, blocks).

We **do not**:

- Sell your data.
- Use third-party ad SDKs or cross-app tracking.
- Show your exact location to anyone.
- Use your messages or photos to train any third-party AI model.

You can see what we hold, download it, correct it, and delete your account from inside the app.

---

## 1. Who we are

**OpenMatch** is operated by **[Legal entity, jurisdiction, address]**. We are the "controller" of your personal data under the GDPR and the "business" under the CCPA/CPRA.

| Role | Contact |
|---|---|
| Privacy questions / rights requests | privacy@openmatch.app |
| EU representative (GDPR Art. 27) | [TBD] |
| UK representative | [TBD] |
| Data Protection Officer | [TBD — required given Art. 9 processing at scale] |
| Quebec privacy officer (Law 25) | [TBD if launching in QC] |
| Brazil DPO (LGPD) | [TBD if launching in BR] |

## 2. What we collect, why, and how long we keep it

| Data | Why | Lawful basis (GDPR) | Retention |
|---|---|---|---|
| Email / phone / Apple subject | Authentication, recovery | Contract (Art. 6(1)(b)) | Life of account + 30 days |
| Date of birth | Age eligibility | Legal obligation (Art. 6(1)(c)) | Life of account |
| Display name, gender, pronouns | Identification | Contract | Life of account |
| Bio, prompts, interests | Profile | Contract | Life of account |
| Photos | Profile | Contract | Life of account |
| Sexual orientation, lifestyle (religion, politics) | Matching, profile | **Explicit consent (Art. 9(2)(a))** | Life of account |
| Precise location (lat/long) | Distance computation | Contract; explicit consent at first capture | Life of account |
| City / region (bucketed) | Public display | Contract | Life of account |
| Preferences | Matching | Contract | Life of account |
| Swipes, likes | Match generation, dedup | Contract | Life of account |
| Messages | Conversations | Contract | Until either party deletes |
| Reports, blocks, moderation actions | Safety | Legal obligation; legitimate interest | Up to 2 years post-resolution; longer if linked to ban |
| Confirmed CSAM hashes | NCMEC reporting | Legal obligation (18 USC 2258A) | Per NCMEC requirements |
| IP, user agent | Security, abuse | Legitimate interest | Hashed at 24 months |
| Push tokens | Notifications | Contract; user-controlled | Until revoked |
| Aggregate analytics events | Service quality | Legitimate interest | 13 months at event grain; aggregates only after |
| Sanctions screening result | Legal obligation | Legal obligation | While account active + 5 years |
| Consent records | Compliance | Legal obligation | Life of account + 3 years |
| DSAR records | Compliance | Legal obligation | 3 years |

The machine-readable register is in [`ropa.yaml`](./ropa.yaml).

## 3. How we use your data

We use it to:

1. Provide the Service (profiles, discovery, chat).
2. Keep the Service safe (reports, blocks, moderation, fraud and scam detection).
3. Communicate with you about your account (security, account changes, moderation outcomes, occasionally product updates if you opt in).
4. Comply with legal obligations (law enforcement requests on lawful process, NCMEC reporting, tax, audit).

We do not make solely automated decisions that have a legal or similarly significant effect on you. Match recommendations are not "significant decisions" within the meaning of GDPR Art. 22. You can still request a human review of any moderation outcome.

## 4. Who we share data with

Only sub-processors that need it to operate the Service. Full list in [`vendor-register.md`](./vendor-register.md).

We share with **law enforcement** only on valid legal process. See [`law-enforcement-guidelines.md`](./law-enforcement-guidelines.md).

We share **CSAM** with NCMEC as legally required.

We share **NCII hashes** with StopNCII.org when a user uses that tool to remove material; we do not share image content.

We **do not** sell your data and we **do not** "share" it for cross-context behavioural advertising as defined under California law.

## 5. International transfers

OpenMatch production data is currently stored in the United States. For users in the EEA, UK, or Switzerland, we use **Standard Contractual Clauses** (and the **UK IDTA Addendum** / **Swiss FDPIC SCCs** as applicable), together with a Transfer Impact Assessment, as the transfer mechanism. If the EU–US Data Privacy Framework status changes, we will update this notice.

## 6. Your rights

Everyone has these rights:

- **Access** — get a copy of the data we hold about you.
- **Correction** — fix data that is inaccurate.
- **Deletion** — delete your account and the data we hold about you.
- **Portability** — get your data in a machine-readable format.
- **Restriction** — limit certain processing.
- **Objection** — object to processing based on legitimate interest, including profiling.
- **Withdraw consent** — withdraw consent for processing based on consent (does not affect prior lawful processing).
- **Complain to a regulator** — see the supplements below for the right one.

To exercise rights: in the app, go to **Profile → Privacy → Manage my data**. Or email **privacy@openmatch.app**. We respond within 30 days (45 days under CCPA/CPRA, with a possible 45-day extension we will tell you about).

## 7. Children

OpenMatch is for adults. We do not knowingly collect personal data from anyone under 18, and accounts identified as under-18 are removed. If you believe a child has provided us data, email **privacy@openmatch.app** and we will delete it.

## 8. Security

We use the controls described in [`docs/privacy/principles.md`](../privacy/principles.md) and our internal security baseline (NIST CSF 2.0; OWASP MASVS for the iOS app; ASVS L2 for the API). No system is perfect; we run a responsible-disclosure programme — see [`SECURITY.md`](../../SECURITY.md).

In the event of a personal data breach we will notify the relevant supervisory authority within **72 hours** of becoming aware (GDPR Art. 33) and affected users without undue delay where required.

## 9. Changes

We will give reasonable notice in-app and by email before material changes take effect.

---

# Jurisdictional supplements

## United States — California (CCPA / CPRA)

- **Categories of personal information collected** in the last 12 months: Identifiers; Personal Information categories under Cal. Civ. Code §1798.80; Protected classification characteristics (gender, sexual orientation — voluntary); Commercial information (account/usage); Internet/Network activity; Geolocation data; Audio/visual (photos); Inferences from the above.
- **Sources:** you; your device; service providers operating the Service.
- **Business purposes:** providing and securing the Service; preventing fraud; complying with law.
- **Sensitive Personal Information (SPI):** precise geolocation; account credentials; sexual orientation / sex life. **You may direct us to limit the use of SPI to what is necessary to provide the Service.** Profile → Privacy → "Limit Use of My Sensitive Information".
- **Sale / share:** We do **not** sell PI and we do **not** share PI for cross-context behavioural advertising.
- **Rights:** Know, Delete, Correct, Limit Use of SPI, Opt out of sale/share (N/A — we don't), Portability, Non-discrimination for exercising rights.
- **How to exercise:** in-app or **privacy@openmatch.app**. We honour the **Global Privacy Control** (GPC) signal on our web property.
- **Authorized agent:** you may designate one in writing.
- **Retention:** see §2.
- Annual metrics on rights requests published in our [Transparency Report](./transparency-report-template.md).

## United States — other state laws (VA, CO, CT, UT, TX, MT, OR, IA, IN, TN, FL, DE, NH, NJ, MD, KY, MN, RI, …)

We treat sexual orientation, precise geolocation, and account credentials as **sensitive** in every state where they qualify. We require **opt-in consent** before processing sensitive data and do not sell or "target advertise" with it. We honour universal opt-out signals where state law recognises them. Maryland (MODPA): our processing is limited to what is reasonably necessary to provide the Service. State-specific contact: **privacy@openmatch.app**, subject line "[State] privacy request".

## United Kingdom

- Data is processed under the UK GDPR and the Data Protection Act 2018.
- Lead supervisory authority: **Information Commissioner's Office (ICO)** — [ico.org.uk/make-a-complaint](https://ico.org.uk/make-a-complaint/).
- UK representative: [TBD].
- Transfers: UK IDTA Addendum + TIA.

## European Economic Area + Switzerland

- Data is processed under the GDPR and (for Swiss users) the revised Federal Act on Data Protection.
- Lead supervisory authority: [TBD once main establishment is determined; users may complain to their local DPA].
- EU representative (Art. 27): [TBD].
- Transfers: SCCs (Modules 2/3 as applicable) + TIA.

## Canada

- Federal law (PIPEDA) applies. Quebec residents are additionally protected by **Law 25**.
- Quebec privacy officer (publicly named under Law 25): [TBD].
- Complaints: Office of the Privacy Commissioner of Canada; CAI for Quebec.

## Brazil

- LGPD applies.
- DPO: [TBD].
- ANPD complaints: [anpd.gov.br](https://www.gov.br/anpd/).

## Australia

- Australian Privacy Principles apply.
- Notifiable Data Breaches scheme followed.
- OAIC complaints: [oaic.gov.au](https://www.oaic.gov.au/).

## Other regions

We will publish supplements before launching in any further geography (Japan/APPI, South Korea/PIPA, India/DPDPA, South Africa/POPIA, New Zealand/Privacy Act 2020). Until then, OpenMatch is not offered to residents of those jurisdictions.

---

## How to contact us about privacy

**Email:** privacy@openmatch.app
**Postal:** [Legal entity address]
**EU rep:** [TBD]
**UK rep:** [TBD]
