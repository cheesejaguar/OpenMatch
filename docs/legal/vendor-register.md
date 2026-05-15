# Vendor & Sub-Processor Register

> Not legal advice. Authoritative list of every party that processes OpenMatch user data on our behalf, with the basis for the relationship. Mirrors `ropa.yaml`. Update **in the same PR** as any vendor change; publish a sub-processor change notice 30 days before adding a new processor of personal data.

## Sub-processors

| Vendor | Role | Data classes | Location | DPA / Contract | Transfer mechanism (from EU/UK) | Notes |
|---|---|---|---|---|---|---|
| **Vercel** | Compute (Functions, region `iad1`), Blob (photos) | profile, photos, request metadata | United States | [Vercel DPA](https://vercel.com/legal/dpa) | SCC (EU 2021/914) + UK IDTA Addendum + TIA | Function logs scrubbed of message bodies. |
| **Neon** | Postgres 16 + PostGIS | all relational data | United States (`us-east-2` today) | [Neon DPA](https://neon.tech/legal/dpa) | SCC + IDTA + TIA | EU region (`eu-central-1`) available; switch is a Phase 3 question. |
| **Upstash** | Redis (cache, rate-limit) | rate-limit counters, short-lived idempotency keys; no user content | Global | [Upstash DPA](https://upstash.com/trust/dpa.pdf) | SCC + IDTA + TIA | No durable user content. |
| **Ably** | Realtime fan-out | conversation IDs, presence | per region | [Ably DPA](https://ably.com/legal/dpa) | SCC + IDTA | Message *bodies* are not stored in Ably; we publish on send and rely on our DB for history. |
| **Apple** | Sign in with Apple, APNs | Apple subject, push tokens | United States | Apple Developer Agreement, Apple PIA | Apple Standard Contract | Push payload content is per user preference. |
| **SMTP provider** | Transactional email | recipient email, message subject/body | vendor region (TBD: Resend or Postmark) | per vendor | SCC | Magic-links, moderation notices, DSAR fulfilment. |
| **NCMEC** | CyberTipline CSAM reports | mandated content + identifiers for confirmed CSAM | United States | 18 USC 2258A | Statutory mandate | Reports are made under federal legal obligation, not contract. |

## Pending / under evaluation

| Candidate | Purpose | Status |
|---|---|---|
| Persona / Yoti / Onfido / Veriff | Age & ID verification | RFP pending; selection criterion is data minimisation (no retained PII beyond a one-way token), BIPA-safe processing in Illinois. |
| PhotoDNA (Microsoft) | Known-CSAM hash matching | License pending; cost is zero for qualifying nonprofits/platforms. |
| StopNCII.org | NCII (non-consensual intimate imagery) hash matching | Application pending. |
| Thorn Safer | Unknown-CSAM classification | Cost evaluation. |
| HackerOne / Bugcrowd | Bug bounty | Decision pending; safe-harbor language already in `SECURITY.md`. |
| Independent privacy / T&S counsel — US | Counsel of record | TBD. |
| Independent privacy / T&S counsel — EU/UK | Counsel of record + DPO | TBD. |

## Diligence checklist (before adding any sub-processor)

- [ ] Signed DPA or equivalent.
- [ ] Adequate transfer mechanism for every flow.
- [ ] Vendor security assessment (SOC 2 / ISO 27001 minimum, or completed questionnaire if absent).
- [ ] Data classes the vendor will touch are listed in `ropa.yaml`.
- [ ] Privacy notice updated.
- [ ] Sub-processor change notice scheduled (30-day notice before live).
- [ ] Termination path: how do we leave and what happens to the data?

## Change log

| Date | Change | PR |
|---|---|---|
| 2026-05-13 | Initial register | this PR |
