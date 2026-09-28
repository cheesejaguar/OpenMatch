# Shipping-readiness refactor — September 2026

Tracking: #115. This is an engineering evidence ledger, not a compliance certification or launch approval.

## Changes and acceptance evidence

| Surface | Change | Regression evidence |
| --- | --- | --- |
| Account shutdown | Request creation, session revocation, visibility, likes, and match shutdown are transactional | Existing account-deletion lockout suite; new lifecycle suite |
| Erasure | One implementation for cron and direct calls; atomic claim, five-minute lease, fencing token, crash recovery, retry on storage failure | Overlapping workers, abandoned lease, storage failure/retry, signup-only deletion |
| Erasure scope | Clear prompts, values, date of birth, verification media, preferences, impressions, push logs, and consent network identifiers | Lifecycle and existing purge suites |
| Cancellation | Multiple historical cancellations allowed; conditional deadline check; preserve bans and keep discovery hidden until explicit opt-in | Repeated cycles, concurrent scheduling, ban and deadline tests |
| Discovery | Candidate-scoped grouped history and impression counts; no arbitrary history truncation | Discovery and matching suites; query result bound is at most two swipe groups per candidate |
| Caches | Share in-flight loads, start TTL on completion, isolate database/app instances, fence invalidation | Cache and readiness concurrency tests |
| Rate limits | Independent route keys, atomic Redis fixed windows, runtime options, HTTP 429 contract | Store contract and route tests |
| Age | Shared UTC calendar calculation, including leap-day birthdays | Birthday-boundary tests |
| DSAR | Aggregate swipe summaries in SQL; 128-bit peer pseudonyms; conservative 28-day internal fulfilment target | Privacy export regression tests |
| CI | Locked installs fail closed; Node 24 matches Docker; repair Biome fix command | Install, typecheck, lint, format, build, and test checks |

## Migration and rollout

Apply `20260927000000_deletion_lifecycle` before starting the new backend. It adds a lease token and replaces the per-status uniqueness constraint with one partial unique index covering scheduled/in-progress requests. Historical cancelled requests can coexist.

Before migrating an existing deployment, check for users with more than one scheduled/in-progress request:

```sql
SELECT "userId", count(*) FROM "AccountDeletionRequest"
WHERE "status" IN ('scheduled', 'in_progress')
GROUP BY "userId" HAVING count(*) > 1;
```

If any exist, adjudicate them before migration; do not discard rights-request records automatically. Roll back application code only after stopping purge workers and inspecting live leases. Old workers do not understand fencing tokens. Database rollback is unsafe after multiple cancellation records exist.

The worker starts no new account after a 45-second run budget. An individual storage operation can still exceed the platform timeout; lease expiry permits retry. Storage must treat repeated deletion of a missing object as success. Alert on overdue requests and repeated storage errors. Exercise the flow with real Blob and verification images on staging.

Cancellation restores account eligibility only when permitted by current ban state. It does not restore terminated conversations, push tokens, sessions, or previous discoverability. Review the client recovery flow and copy before rollout.

## Release gates that code alone cannot satisfy

- Establish launch countries, controller identity, lawful bases, special-category consent, data processing agreements, transfer safeguards, and the applicable rights-response procedures with counsel. The 28-day target is an internal SLA, not a substitute for jurisdiction-specific deadline handling.
- Review every retained conversation, message, safety report, feedback note, legal hold, backup, and vendor copy. A stable user tombstone is **pseudonymous**, not anonymous. This refactor preserves existing conversation/safety retention; it does not authorize indefinite retention.
- Verify consent withdrawal actually disables each associated processing purpose. Recording a withdrawal alone is insufficient. Review age-assurance effectiveness; self-declared birthdays and selfie poses do not establish legal age.
- Inventory all media, including voice messages and historical verification uploads, and test deletion across vendor storage, CDN caches, backup expiry, and late in-flight uploads. Historical objects without references need an operator reconciliation job.
- Complete a DPIA where applicable, incident/breach exercises, safety escalation coverage, NCMEC/CSAM reporting readiness, and DSA/other notice-and-action applicability review.
- Run native iOS build/tests, VoiceOver/Dynamic Type checks, privacy-manifest and App Store disclosure checks, and admin keyboard/screen-reader audits. No WCAG conformance claim is made here.
- Load-test real Neon/PostGIS, Upstash, Ably, SMTP, and Blob. Grouped queries reduce returned rows; no production latency improvement is claimed without measurements. Candidate preselection still uses an unordered 500-row cap and needs a separate fairness-reviewed redesign.
- Require CI and privacy/safety maintainer approval, resolve the backend coverage gate, and perform a staging restore/rollback rehearsal before enabling production traffic. The refreshed dependency lockfile reports zero npm audit vulnerabilities as of this change; keep scanning it for new advisories.

## Validation and open engineering blocker

Matching (86 tests) and admin (29 tests) pass with coverage. Backend regression tests pass locally against PGlite/PostGIS; conventional PostgreSQL CI remains authoritative for concurrency. Its first run exposed a Prisma empty-update upsert race. Notification defaults and immutable policy publication now use conflict-safe inserts; the concurrent initialization regression is retained and existing-preference preservation is tested.

Lint, formatting, workspace typechecks, generated-code checks, backend and admin builds, and the dependency audit pass. The license inventory has no forbidden or unknown packages; nine packages require review.

The upgraded Vitest coverage engine reports backend branch/function coverage below the existing global thresholds, plus a DSA SLA worker branch shortfall. Thresholds are unchanged. This is an unresolved release gate requiring meaningful test backfill, not grounds to lower the checks or claim this draft is ready to merge. Native iOS, production load, accessibility, and vendor end-to-end checks have not been completed.

## Reference standards and guidance

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) — use as the application-security verification baseline; this is not a completed ASVS assessment.
- [EDPB data protection by design/default guidance](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en).
- [EDPB individual rights guidance](https://www.edpb.europa.eu/sme-data-protection-guide/respect-individuals-rights_en).

Deployment evidence and reviewer decisions must be appended to the release record. Do not promote an implementation checklist to a legal or operational compliance claim.
