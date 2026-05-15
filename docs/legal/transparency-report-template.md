# OpenMatch Transparency Report — Template

> Not legal advice. The first transparency report will be published within 12 months of public launch and refreshed on a schedule that meets the EU DSA cadence (yearly minimum). This template is the canonical shape; numbers and prose go in `transparency/<year>-<period>.md` when published.

## Reporting period

`YYYY-Qn` or `YYYY-H1 / H2` or `YYYY`. The DSA requires yearly. We prefer half-yearly once we have data.

## 1. Service and methodology

- Service surface and where it operated during the period.
- Definitions used (what counts as a "report", "action", "appeal", etc.).
- Methodology notes for AMAR (Average Monthly Active Recipients) calculation per DSA Art. 24(2).

## 2. Average Monthly Active Recipients (DSA)

| Member State | AMAR |
|---|---|
| Total | … |
| Per-state breakdown | … |

If AMAR ≥ 45M in the EU, we are a VLOP and the following sections expand under DSA Section 5 obligations.

## 3. Content moderation

### 3.1 Reports received

| Reason | Count |
|---|---|
| Harassment | … |
| Hate / discrimination | … |
| Threats / violence | … |
| Sexual content | … |
| Scam / spam | … |
| Fake / duplicate profile | … |
| Underage | … |
| Impersonation | … |
| Off-platform solicitation | … |
| Other | … |
| **Total** | … |

### 3.2 Sources

| Source | Count |
|---|---|
| User reports | … |
| Trusted-flagger reports | … |
| Automated detection (hash match, scam-pattern rules) | … |
| Authority orders | … |
| Other | … |

### 3.3 Actions taken (DSA Art. 17 categories)

| Action | Count |
|---|---|
| No action | … |
| Content removed | … |
| Photo removed | … |
| Account warning | … |
| Account temporary suspension | … |
| Account permanent ban | … |
| Visibility restriction | … |
| Monetary measure | N/A |
| Termination of service | … |

### 3.4 Response times

| Stage | Median | P90 | P99 |
|---|---|---|---|
| First triage | … | … | … |
| Resolution | … | … | … |
| Appeal outcome | … | … | … |

### 3.5 Statements of reasons

- Number sent to users: …
- Number submitted to the DSA Transparency Database: …

## 4. Appeals

| Appeal outcome | Count |
|---|---|
| Upheld (original decision stands) | … |
| Reduced (action softened) | … |
| Reversed | … |
| Dismissed (out of scope / late) | … |

## 5. Out-of-court dispute settlement (DSA Art. 21)

| Stage | Count |
|---|---|
| Disputes referred | … |
| Outcomes in user's favour | … |
| Outcomes in our favour | … |
| Ongoing | … |

## 6. Authority orders (DSA Art. 9 / 10)

| Order type | Count | Member state of issuing authority | Median response time |
|---|---|---|---|
| Order to act against illegal content | … | … | … |
| Order to provide information | … | … | … |

## 7. Child safety

- NCMEC CyberTipline reports filed: …
- TAKE IT DOWN Act removal requests received: …
- Median time to removal: … (statutory target 48h)
- Underage account terminations: …

## 8. Law-enforcement requests (US / non-DSA)

| Request type | Received | Produced (any data) | Produced (content) | Rejected |
|---|---|---|---|---|
| Subpoenas | … | … | … | … |
| Court orders (2703(d) or equiv.) | … | … | … | … |
| Search warrants | … | … | … | … |
| Emergency disclosure requests | … | … | … | … |
| Preservation requests | … | n/a | n/a | … |
| MLAT / cross-border | … | … | … | … |

## 9. Personal data requests (rights)

| Right | Received | Fulfilled in 30d (GDPR) | Fulfilled in 45d (CCPA) | Refused (with reason) |
|---|---|---|---|---|
| Access | … | … | … | … |
| Deletion | … | … | … | … |
| Correction | … | … | … | … |
| Portability | … | … | … | … |
| Restriction / object | … | … | … | … |
| Limit Use of SPI (CA) | … | n/a | … | … |

## 10. Breaches

| Severity | Count | Regulator notifications | User notifications |
|---|---|---|---|
| High-risk (Art. 34 / state user-notice) | … | … | … |
| Reportable but not high-risk | … | … | n/a |
| Internally tracked, non-reportable | … | n/a | n/a |

## 11. Algorithm transparency

- Algorithm version published at end of period: …
- Algorithm changes during the period: … (link to `docs/algorithm/CHANGELOG.md` for each)
- Number of users who opted into the non-personalised feed: …
- Fairness audit results: … (link to audit doc)

## 12. Trusted flaggers (DSA Art. 22)

| Flagger | Reports received | Median triage time |
|---|---|---|

## 13. Resources

- Engineers and moderators dedicated to T&S during the period: …
- Languages supported by moderation: …

## 14. Notes and methodology updates

- Anything changed in how we count, classify, or report.

---

## Production notes (not published)

- Numbers are derived from the admin metrics pipeline (`backend/src/routes/admin/metrics.ts`).
- DSA Transparency Database submissions are made continuously, not bulk; the count here is reconciled against the database export.
- This document is finalised by the Privacy + T&S leads with counsel review.
