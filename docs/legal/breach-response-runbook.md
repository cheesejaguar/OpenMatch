# Personal Data Breach Response Runbook

> Not legal advice. This runbook is the operational playbook for responding to a personal-data breach. It encodes statutory time limits (GDPR Art. 33: **72 hours**; state laws: "without unreasonable delay" with various caps; HIPAA: 60 days — N/A here) into the workflow. Counsel sign-off is required at every external-notification step.

## 1. Definitions

- **Personal data breach (GDPR Art. 4(12)):** a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data.
- **Confidentiality breach** — data disclosed to or accessed by an unauthorised party.
- **Integrity breach** — data altered.
- **Availability breach** — data lost or made inaccessible.

## 2. Who's involved

| Role | Default holder | Responsibilities |
|---|---|---|
| Incident commander | On-call engineer | Owns the response, calls the meetings, runs the war-room. |
| Security lead | Founder (until hire) | Forensics, scope, contain, eradicate. |
| Privacy lead | DPO (when appointed) | Risk-to-data-subjects analysis; notification obligations. |
| Legal | Counsel of record | Regulator coordination; preservation; privilege. |
| Communications | Founder | External comms; user notice; press if applicable. |
| Engineering | Service owner | Remediation, evidence preservation. |

## 3. Phases

### 3.1 Detect (T+0)

Triggers:

- Pager alert: anomalous DB queries, mass-export-like traffic, exfiltration honeypot tripped.
- Internal report (engineer, vendor).
- External report (bug bounty, security researcher, regulator, user).

The on-call engineer immediately opens an incident channel `#incident-<date>-<short>` and begins a timeline document.

### 3.2 Contain (T+0 → T+1h)

- Cut off the attacker / actor (revoke keys, rotate secrets, suspend accounts, block IPs).
- **Do not destroy evidence.** Snapshot logs, DB state, and any compromised systems.
- Notify Security lead → Privacy lead → Legal.

### 3.3 Assess (T+1h → T+24h)

Answer:

1. What data classes were affected? (Cross-reference [`ropa.yaml`](./ropa.yaml).)
2. How many data subjects? Which jurisdictions?
3. Was sensitive / Art. 9 data involved?
4. What is the likelihood of risk to rights and freedoms?
5. What is the likelihood of *high* risk (Art. 34 user-notification trigger)?
6. What state breach-notice statutes are triggered (any U.S. resident: assume all 50 + DC are in scope for analysis)?

Output: a written risk assessment, signed off by Privacy lead.

### 3.4 Notify regulators (T+24h → T+72h)

- **GDPR Art. 33** — supervisory authority **within 72 hours** of becoming aware, unless the breach is unlikely to result in a risk to rights and freedoms. Use [the lead authority's standard form]; if facts are still developing, file a partial notification and follow up.
- **UK ICO** — within 72 hours; use the [ICO online form](https://ico.org.uk/for-organisations/report-a-breach/).
- **State AGs (US)** — per the state matrix below. Thresholds vary; some require AG notice at any count, others at 250 or 500 residents.
- **Other regulators** (ANPD, OAIC, OPC/CAI, IDPC, etc.) per jurisdiction.

### 3.5 Notify affected users (without undue delay)

- Required by GDPR Art. 34 when the breach is **likely to result in a high risk** to rights and freedoms.
- Required by state laws **for any breach of "personal information" as defined per state** (definitions vary; CA, IL, MA, NY are most prescriptive).
- Notice content: nature of the breach, types of data affected, likely consequences, measures taken, contact for more information, steps the user can take.
- Channel: email + in-app, with web mirror.

A breach-notice template is at [`templates/breach-notice.md`](./templates/breach-notice.md) (TBD — to be added when first templated).

### 3.6 Eradicate, recover, learn

- Patch root cause; deploy.
- Rotate all credentials with any plausible exposure.
- Restore from clean backups if needed.
- Post-incident review within 14 days, blameless write-up, action items tracked.

## 4. State-by-state US notification matrix (high-level)

> Counsel of record maintains the canonical per-state matrix. Below is the engineering-facing summary.

| State | Notice to residents | Notice to AG | Notice to credit bureaus | Maximum delay |
|---|---|---|---|---|
| California | Any breach of "PI" | If > 500 residents | If > 500 residents | "Most expedient time possible" |
| New York | Any breach | If > 500 NY residents | If > 5,000 affected | "Most expedient time possible" |
| Illinois | Any breach of "PII" | If > 500 IL residents (BIPA separate) | — | 45 days |
| Texas | Any breach | If > 250 residents | — | 60 days |
| Florida | Any breach | If > 500 FL residents | — | 30 days |
| Massachusetts | Any breach | Yes (any count) | Yes (any count) | "As soon as practicable" |
| Washington | Any breach | If > 500 WA residents | — | 30 days |
| Virginia | Any breach | If > 1,000 affected nationally | — | "Without unreasonable delay" |
| Other US states | Refer to canonical matrix maintained by counsel. | — | — | — |

## 5. Vendor-side breaches

If a sub-processor experiences a breach affecting OpenMatch data:

- We treat their notification as our T+0.
- Our 72-hour clock starts when **we** become aware.
- We will not let a vendor unilaterally decide whether the breach is "low risk" — that determination is ours.

## 6. Preservation

- Preserve logs for **at least 1 year** after a breach is closed; longer if subject to litigation hold.
- Preserve all related communications under privilege where possible.

## 7. After-action

- Public post-mortem (suitably redacted) within 60 days where appropriate.
- Aggregate breach counts included in the next [Transparency Report](./transparency-report-template.md).
- Update this runbook with anything learned.
