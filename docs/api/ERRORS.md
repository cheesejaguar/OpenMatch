# OpenMatch API error codes

This file is generated from `backend/src/lib/error-codes.ts` via
`scripts/generate-error-docs.mjs`. Do not edit by hand.

Every API error response from the backend has the shape:

```json
{ "error": "<code>", "message": "optional human text", "fields": [/* validation only */] }
```

`error` is the stable machine-readable identifier listed below. Clients
MUST branch on this string, not on `message`.

## Validation

| Code | HTTP | Description |
| --- | --- | --- |
| `already_exists` | 409 | Resource already exists (unique constraint conflict). |
| `conflict` | 409 | Request conflicts with current resource state. |
| `forbidden` | 403 | Authenticated but not permitted to perform this action. |
| `internal_error` | 500 | Unexpected server error. Captured to Sentry. |
| `invalid_payload` | 400 | Generic malformed input that didn't match a schema. |
| `invalid_request` | 400 | Generic invalid request (used when no more specific code applies). |
| `not_found` | 404 | The requested resource does not exist or the caller cannot see it. |
| `rate_limited` | 429 | Too many requests; back off and retry. |
| `unauthorized` | 401 | Missing or invalid authentication. |
| `validation_failed` | 400 | Request payload failed schema validation; see fields[] for details. |

## Auth

| Code | HTTP | Description |
| --- | --- | --- |
| `apple_identity_token_required` | 400 | An appleIdentityToken is required for the Apple auth method. |
| `apple_invalid_sub` | 400 | Apple identity token did not carry a usable subject claim. |
| `apple_not_configured` | 501 | Sign in with Apple is not configured for this deployment. |
| `apple_verification_failed` | 401 | Apple identity token verification failed. |
| `challenge_expired` | 400 | The auth challenge has expired; start a new login. |
| `challenge_not_found` | 404 | The auth challenge could not be found. |
| `challenge_used` | 400 | The auth challenge has already been consumed. |
| `dev_login_disabled` | 403 | Dev login is not enabled in this environment. |
| `dev_user_id_required` | 400 | Dev login requires a devUserId in the payload. |
| `email_invalid` | 400 | The supplied email did not parse as a valid address. |
| `email_required` | 400 | An email address is required for this authentication method. |
| `invalid_challenge` | 400 | The auth challenge id does not exist. |
| `invalid_refresh` | 401 | Refresh failed (alias of refresh_token_invalid emitted by admin auth). |
| `invalid_refresh_token` | 401 | Refresh failed (alias of refresh_token_invalid emitted by consumer auth). |
| `invalid_token` | 400 | The supplied token is not valid for this challenge. |
| `refresh_token_invalid` | 401 | The refresh token was unknown, expired, or already revoked. |
| `refresh_token_reused` | 401 | A previously-revoked refresh token was presented; all sessions for the user have been revoked. |
| `token_mismatch` | 400 | The supplied magic-link / verification token did not match the challenge. |
| `unknown_method` | 400 | The supplied authentication method is not recognised. |

## Admin

| Code | HTTP | Description |
| --- | --- | --- |
| `admin_action_invalid` | 400 | The admin action requested is not valid in the current state. |
| `admin_disabled` | 403 | Admin user account is disabled. |
| `admin_forbidden` | 403 | Admin caller lacks the required permission. |
| `admin_not_found` | 404 | Admin user does not exist. |
| `admin_rbac_denied` | 403 | Admin RBAC denied this action; see `required` for the missing permission. |
| `admin_user_not_found` | 404 | The admin user id is unknown. |
| `invalid_recovery_code` | 401 | The supplied TOTP recovery code is not valid or has been consumed. |
| `invalid_totp_code` | 401 | The supplied TOTP code is not valid. |
| `recovery_code_invalid` | 401 | The supplied TOTP recovery code is not valid or has been consumed. |
| `session_missing_sid` | 409 | Cannot elevate an admin session that lacks a session id; re-issue tokens via /auth/verify. |
| `totp_invalid` | 401 | The supplied TOTP code is not valid. |
| `totp_not_enrolled` | 409 | TOTP has not been enrolled for this admin yet. |
| `two_factor_required` | 403 | This admin endpoint requires an elevated (2FA) session. |
| `would_lock_out_system_admin` | 409 | Refusing to remove the last system_admin role from an active admin. |

## Beta gates

| Code | HTTP | Description |
| --- | --- | --- |
| `country_not_supported` | 451 | OpenMatch is not available in the inferred country (sanctions, LGBTQ-safety, or unsupported launch geography). |
| `invite_code_required` | 400 | An invite code is required for this flow. |
| `invite_exhausted` | 409 | The invite code has reached its maximum number of uses. |
| `invite_expired` | 400 | The invite code has expired. |
| `invite_invalid` | 400 | The supplied invite code is unknown or malformed. |
| `invite_race` | 409 | Lost a race against another redemption of the same invite code. |
| `invite_required` | 403 | Signups currently require a beta invite code. |
| `invite_revoked` | 400 | The invite code has been revoked. |
| `outside_metro` | 451 | The declared location is outside every active beta metro. |
| `signups_paused` | 503 | Operational kill-switch: new signups are paused. |

## Profile

| Code | HTTP | Description |
| --- | --- | --- |
| `duplicate_photos` | 400 | The reorder payload contains duplicate photo ids. |
| `invalid_dob` | 400 | The supplied date of birth could not be parsed. |
| `max_photos_reached` | 400 | The profile already has the maximum number of photos. |
| `min_age_above_max` | 400 | minAge cannot be greater than maxAge. |
| `no_file` | 400 | The multipart upload did not include a file part. |
| `payload_too_large` | 413 | The uploaded file exceeds the size limit. |
| `photo_not_found` | 404 | The photo id does not exist for this profile. |
| `photo_not_owned` | 400 | A photo id in the reorder payload does not belong to this profile. |
| `profile_not_found` | 404 | The caller does not yet have a Profile row. |
| `underage` | 403 | The declared date of birth is under 18. |
| `unsupported_media_type` | 415 | The uploaded file's MIME type is not in the allowlist. |
| `upload_failed` | 500 | Photo upload to blob storage failed. |

## Discovery

| Code | HTTP | Description |
| --- | --- | --- |
| `already_blocked` | 409 | This user is already on the caller's block list. |
| `cannot_block_self` | 400 | A user cannot block themselves. |
| `cannot_report_self` | 400 | A user cannot report themselves. |
| `conversation_not_found` | 404 | The conversation id is unknown. |
| `empty_message` | 400 | The chat message body is empty. |
| `match_not_found` | 404 | The match id is unknown or the caller is not a participant. |
| `message_too_long` | 400 | The chat message body exceeds the length limit. |
| `missing_location` | 400 | Either the viewer or the candidate has no recorded location. |
| `not_participant` | 403 | Caller is not a participant in this conversation. |
| `target_not_found` | 404 | The target profile does not exist. |
| `undo_not_available` | 400 | The swipe cannot be undone (too old, already undone, or moderation locked). |
| `user_blocked` | 403 | Action blocked because one party has blocked the other. |
| `viewer_has_no_location` | 400 | The viewer has no recorded geographic location. |
| `viewer_not_initialized` | 400 | The viewer has no profile or preferences yet. |

## Realtime

| Code | HTTP | Description |
| --- | --- | --- |
| `realtime_unconfigured` | 503 | Realtime backend (Ably) is not configured in this environment. |

## Safety

| Code | HTTP | Description |
| --- | --- | --- |
| `access_reason_required` | 412 | Reading this entity requires a sensitive-access grant; create one and pass accessGrantId. |
| `dsa_notice_not_found` | 404 | The DSA notice id is unknown. |
| `grace_period_expired` | 410 | The deletion grace period has expired and cannot be cancelled. |
| `grace_period_not_yet_expired` | 425 | The deletion grace period has not yet elapsed. |
| `no_active_ban` | 404 | The user has no active ban to lift. |
| `no_scheduled_deletion` | 404 | No scheduled account deletion exists for this user. |
| `not_authorized` | 403 | Caller is not authorised to act on this resource. |
| `policy_document_missing` | 503 | No effective PolicyDocument is published for the requested scope. |
| `report_not_found` | 404 | The report id is unknown. |

## Internal

| Code | HTTP | Description |
| --- | --- | --- |
| `internal_token_invalid` | 401 | Internal worker token missing or wrong; cron endpoint refused. |

## Misc

| Code | HTTP | Description |
| --- | --- | --- |
| `user_not_found` | 404 | The user id is unknown. |
