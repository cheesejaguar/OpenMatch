# Service-level objectives — OpenMatch v0 beta

Window: rolling 30 days. Error budget = `(1 - SLO) × budget_minutes`.

## Availability
- **Backend API** — 99.5 % monthly uptime measured against `/ready` (216 min/30d budget).
- **iOS app** — 99.0 % crash-free sessions, rolling 7 days, via Sentry.

## Latency
- **p95 backend endpoint latency** < 500 ms (excludes `/api/v1/admin/*`).
- **p99** < 1.5 s.

## Safety SLAs
- DSA Art. 16 notices acknowledged < 24 h, decided < 48 h.
- Reports first-touch < 4 h during PT business hours.
- Photo moderation first-touch < 24 h.

## Push delivery
- 99 % of match notifications delivered < 60 s after match creation.

## Alert routing
| Condition | Burns budget? | Page on-call? |
| --- | --- | --- |
| 5xx error rate > 1 % over 5 min | yes | yes |
| `/ready` returns 503 over 1 min | yes | yes |
| DSA SLA breached | no (compliance) | yes |
| Report queue oldest > 4 h | no | warn |

Each SLO has a quarterly review pegged to the day-14 / day-28 cohort go/no-go.
