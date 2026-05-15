# Law Enforcement Guidelines

> Not legal advice. These guidelines describe how OpenMatch responds to law-enforcement requests. They do not create rights for any party. They are subject to change without notice and may not apply in any particular case for legal, operational, or safety reasons.

## Contact

| Channel | Use it for |
|---|---|
| **legal@openmatch.app** | Subpoenas, search warrants, court orders, MLAT requests, preservation requests. PGP key fingerprint: [TBD]. |
| **Emergency disclosure (US):** legal-emergency@openmatch.app | 18 USC 2702(b)(8) / (c)(4) emergencies involving imminent risk of death or serious physical injury. Provide the EDR form linked at [`/legal/edr`]. |

We **do not** accept service of legal process by social media, in-app message, or telephone.

## What we will respond to

| Request type | What we may produce | Required legal basis |
|---|---|---|
| Basic subscriber information (account exists, dates active, email-hash, last-IP-hash) | Limited subscriber records | A **subpoena** issued under US law, or equivalent compulsory process in the requester's jurisdiction. |
| Non-content records (login history, device tokens, IP hashes, public profile snapshots) | Non-content metadata | A **court order under 18 USC 2703(d)** or equivalent. |
| Content (messages, photos, reports, profile data including DOB, full IPs if retained) | Stored content | A **search warrant** issued upon probable cause under Rule 41 (US) or equivalent (e.g., EU EIO, UK production order). |
| CSAM-related | Whatever the law mandates | Statutory — we report to NCMEC under 18 USC 2258A regardless of separate process. |
| Preservation | We will preserve account records for 90 days, renewable once | A written preservation request under **18 USC 2703(f)** or equivalent. |
| Foreign requests | Routed through MLAT or applicable cross-border mechanism | MLAT, EU EIO, CLOUD Act–compliant agreement, or letter rogatory. |

## What we will not produce

- The **content of communications** without a search warrant or its functional equivalent.
- **Real-time intercepts** without a Title III wiretap order.
- **Anything beyond the scope** of the legal process served. We narrowly construe over-broad requests.
- Data we **do not have** (we cannot produce what we do not retain — see our [Privacy Notice](./privacy-notice.md) §2 retention table).

## User notice

Unless we are legally prohibited from doing so (gag order, sealed court order, NCMEC-related, or where notice would create a credible risk of imminent harm), we will provide notice to the affected user before producing data. We will tell them what was requested and by whom, with enough detail to seek legal advice.

We will also publish aggregate counts of law-enforcement requests in our [Transparency Report](./transparency-report-template.md).

## Cost reimbursement

We may seek reimbursement of costs as permitted by 18 USC 2706 or equivalent.

## Authentication

We may verify the authenticity of any legal process before responding. We expect:

- Service from an official law-enforcement email domain or by traditional process.
- A clear identification of the requesting officer and case.
- Identification of the specific OpenMatch account by **user ID, hashed email, or username** — we do not search by content.
