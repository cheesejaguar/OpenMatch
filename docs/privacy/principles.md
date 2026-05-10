# OpenMatch Privacy Principles

OpenMatch treats privacy as a product feature, not a compliance afterthought. These principles are what the code is required to deliver — not aspirations.

## 1. Minimum collection

We collect only what is needed to operate the service safely.

| What we collect           | Why                                                    | Visible to others?    |
| ------------------------- | ------------------------------------------------------ | --------------------- |
| Display name              | Identification within the app                          | Yes                   |
| Date of birth             | Age verification, age-based eligibility                | Only age, not DOB     |
| Email                     | Authentication, account recovery                       | No                    |
| Phone (optional)          | Authentication, account recovery                       | No                    |
| Apple Sign-In subject     | Authentication                                         | No                    |
| Photos                    | Profile presentation                                   | Yes (you choose)      |
| Location                  | Distance filtering                                     | Bucketed text only    |
| Preferences               | Matching                                               | No                    |
| Swipes                    | Match generation, de-duplication                       | No                    |
| Messages                  | Conversation                                           | Only your match       |
| Reports / blocks          | Safety                                                 | No                    |

## 2. Public vs private

| Public to other users                    | Private                                       |
| ---------------------------------------- | --------------------------------------------- |
| Display name, age, gender, pronouns      | Date of birth                                 |
| Bio, prompts, interests                  | Email, phone                                  |
| Photos                                   | Apple subject, device IDs                     |
| Approximate distance / city              | Exact coordinates                             |
| Verification badge                       | Moderation history                            |
|                                          | Internal safety signals                       |
|                                          | Swipe history                                 |
|                                          | Block / report content                        |

## 3. Location

- Stored at PostGIS precision internally so that distance queries are accurate.
- **Surfaced to other users only as bucketed text** — "8 miles away", "San Jose, CA", or "Nearby".
- The single helper `formatDistance` is the only sanctioned way to render distance. Bypassing it is a privacy bug.
- Users can opt to use a manually selected city instead of device location.
- Users can pause discovery, which removes them from both directions of discovery.

## 4. Data export

Users can export, on demand:

- Their profile and preferences.
- Their photo metadata.
- Their matches.
- Their messages (subject to legal/safety retention exceptions).
- Their swipes and likes — **only the actions they themselves took**, never the visibility of other users.

Export never reveals private data about other users beyond what the exporting user already legitimately sees.

## 5. Data deletion

Account deletion:

- Removes profile from discovery **immediately** (before async cleanup completes).
- Deletes or anonymizes profile fields.
- Deletes photos from object storage.
- Removes device tokens, sessions, and refresh tokens.
- Retains the minimum needed for fraud, abuse, and legal compliance, per a written retention policy.

Messages in a conversation persist for the other participant, subject to the retention policy, so deletion does not become an abuse vector. The deleted user's identity is reduced to a tombstone in those threads.

## 6. Analytics

- **No third-party ad SDKs.** None, ever.
- **No cross-app tracking.** No IDFA usage for advertising.
- **First-party, aggregate metrics only.** No per-user event streams in analytics.
- **No message content** in analytics.
- **No exact location** in analytics.
- **No sensitive fields** in analytics unless aggregated and policy-approved.

## 7. User-controlled privacy settings

- Discovery visibility (visible / paused).
- Incoming-likes visibility (visible / count-only / hidden).
- Notification previews (full / sender-only / hidden).
- Online / active status (visible / hidden).
- Per-field visibility for some optional fields.
- Read receipts (if and when implemented — off by default).

## 8. Internal access

- Moderator access to private user data requires a justification that is logged.
- Audit logs are reviewed regularly.
- Least-privilege role-based access control across all moderation tooling.

## 9. Algorithm and privacy

Private data does **not** influence ranking. See [`../algorithm/spec.md`](../algorithm/spec.md). Specifically forbidden as ranking inputs: payment, inferred income, device price, "attractiveness" scores, vulnerability inference, engagement-maximization predictions.

## 10. Reporting privacy issues

See [`/SECURITY.md`](../../SECURITY.md). Privacy and security reports are handled identically.
