// Central registry of every API-visible error code emitted by the
// backend. Each code maps to a canonical HTTP status + a one-line
// human description that the docs generator (scripts/generate-error-docs.mjs)
// turns into docs/api/ERRORS.md.
//
// Rules:
//   - Add a code here BEFORE using it in a route. Tests + iOS depend on
//     the string being stable across releases; renaming is a breaking
//     change.
//   - Every code MUST have a matching entry in ERROR_CODE_META.
//   - HTTP status is the *default* for that code. Routes may override
//     the status via httpError(code, { status: ... }) when context
//     genuinely demands it; that's rare.

export const ErrorCodes = {
  // ---- Validation / generic -------------------------------------------
  VALIDATION_FAILED: "validation_failed",
  INVALID_PAYLOAD: "invalid_payload",
  INVALID_REQUEST: "invalid_request",
  NOT_FOUND: "not_found",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  RATE_LIMITED: "rate_limited",
  INTERNAL_ERROR: "internal_error",
  CONFLICT: "conflict",
  ALREADY_EXISTS: "already_exists",

  // ---- Auth -----------------------------------------------------------
  EMAIL_REQUIRED: "email_required",
  EMAIL_INVALID: "email_invalid",
  UNKNOWN_METHOD: "unknown_method",
  INVALID_CHALLENGE: "invalid_challenge",
  CHALLENGE_NOT_FOUND: "challenge_not_found",
  CHALLENGE_EXPIRED: "challenge_expired",
  CHALLENGE_USED: "challenge_used",
  TOKEN_MISMATCH: "token_mismatch",
  INVALID_TOKEN: "invalid_token",
  REFRESH_TOKEN_INVALID: "refresh_token_invalid",
  REFRESH_TOKEN_REUSED: "refresh_token_reused",
  INVALID_REFRESH: "invalid_refresh",
  INVALID_REFRESH_TOKEN: "invalid_refresh_token",
  DEV_LOGIN_DISABLED: "dev_login_disabled",
  DEV_USER_ID_REQUIRED: "dev_user_id_required",
  APPLE_NOT_CONFIGURED: "apple_not_configured",
  APPLE_IDENTITY_TOKEN_REQUIRED: "apple_identity_token_required",
  APPLE_VERIFICATION_FAILED: "apple_verification_failed",
  APPLE_INVALID_SUB: "apple_invalid_sub",
  APPLE_NONCE_REQUIRED: "apple_nonce_required",
  APPLE_NONCE_MISMATCH: "apple_nonce_mismatch",
  APPLE_EMAIL_UNVERIFIED: "apple_email_unverified",

  // ---- Admin auth / 2FA ----------------------------------------------
  ADMIN_NOT_FOUND: "admin_not_found",
  ADMIN_DISABLED: "admin_disabled",
  TWO_FACTOR_REQUIRED: "two_factor_required",
  TOTP_INVALID: "totp_invalid",
  INVALID_TOTP_CODE: "invalid_totp_code",
  RECOVERY_CODE_INVALID: "recovery_code_invalid",
  INVALID_RECOVERY_CODE: "invalid_recovery_code",
  TOTP_NOT_ENROLLED: "totp_not_enrolled",
  TOTP_ALREADY_ENROLLED: "totp_already_enrolled",
  SESSION_MISSING_SID: "session_missing_sid",

  // ---- Beta gates -----------------------------------------------------
  INVITE_REQUIRED: "invite_required",
  INVITE_CODE_REQUIRED: "invite_code_required",
  INVITE_INVALID: "invite_invalid",
  INVITE_EXHAUSTED: "invite_exhausted",
  INVITE_EXPIRED: "invite_expired",
  INVITE_REVOKED: "invite_revoked",
  INVITE_RACE: "invite_race",
  SIGNUPS_PAUSED: "signups_paused",
  OUTSIDE_METRO: "outside_metro",
  COUNTRY_NOT_SUPPORTED: "country_not_supported",

  // ---- Profile / photos -----------------------------------------------
  UNDERAGE: "underage",
  INVALID_DOB: "invalid_dob",
  PROFILE_NOT_FOUND: "profile_not_found",
  MAX_PHOTOS_REACHED: "max_photos_reached",
  NO_FILE: "no_file",
  UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
  PAYLOAD_TOO_LARGE: "payload_too_large",
  PHOTO_NOT_FOUND: "photo_not_found",
  PHOTO_NOT_OWNED: "photo_not_owned",
  DUPLICATE_PHOTOS: "duplicate_photos",
  MIN_AGE_ABOVE_MAX: "min_age_above_max",
  UPLOAD_FAILED: "upload_failed",
  PHOTO_URL_TOKEN_INVALID: "photo_url_token_invalid",
  PHOTO_URL_TOKEN_EXPIRED: "photo_url_token_expired",

  // ---- Discovery / swipe / match / chat -------------------------------
  VIEWER_NOT_INITIALIZED: "viewer_not_initialized",
  VIEWER_HAS_NO_LOCATION: "viewer_has_no_location",
  MISSING_LOCATION: "missing_location",
  TARGET_NOT_FOUND: "target_not_found",
  UNDO_NOT_AVAILABLE: "undo_not_available",
  MATCH_NOT_FOUND: "match_not_found",
  CONVERSATION_NOT_FOUND: "conversation_not_found",
  NOT_PARTICIPANT: "not_participant",
  USER_BLOCKED: "user_blocked",
  ALREADY_BLOCKED: "already_blocked",
  EMPTY_MESSAGE: "empty_message",
  MESSAGE_TOO_LONG: "message_too_long",
  MESSAGE_REJECTED_BY_MODERATION: "message_rejected_by_moderation",
  PHOTO_REJECTED_BY_MODERATION: "photo_rejected_by_moderation",
  CANNOT_BLOCK_SELF: "cannot_block_self",
  CANNOT_REPORT_SELF: "cannot_report_self",

  // ---- Realtime -------------------------------------------------------
  REALTIME_UNCONFIGURED: "realtime_unconfigured",

  // ---- Safety / DSA / privacy -----------------------------------------
  REPORT_NOT_FOUND: "report_not_found",
  DSA_NOTICE_NOT_FOUND: "dsa_notice_not_found",
  POLICY_DOCUMENT_MISSING: "policy_document_missing",
  NO_ACTIVE_BAN: "no_active_ban",
  NO_SCHEDULED_DELETION: "no_scheduled_deletion",
  GRACE_PERIOD_EXPIRED: "grace_period_expired",
  GRACE_PERIOD_NOT_YET_EXPIRED: "grace_period_not_yet_expired",
  NOT_AUTHORIZED: "not_authorized",
  ACCESS_REASON_REQUIRED: "access_reason_required",

  // ---- Admin ----------------------------------------------------------
  ADMIN_FORBIDDEN: "admin_forbidden",
  ADMIN_RBAC_DENIED: "admin_rbac_denied",
  ADMIN_USER_NOT_FOUND: "admin_user_not_found",
  ADMIN_ACTION_INVALID: "admin_action_invalid",
  WOULD_LOCK_OUT_SYSTEM_ADMIN: "would_lock_out_system_admin",

  // ---- Worker / internal ---------------------------------------------
  INTERNAL_TOKEN_INVALID: "internal_token_invalid",

  // ---- Misc -----------------------------------------------------------
  USER_NOT_FOUND: "user_not_found",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorCodeMeta {
  status: number;
  description: string;
  // Optional human-friendly grouping for the docs generator. Falls back
  // to "Other" when omitted.
  group?: string;
}

// Single source of truth for "what HTTP status does this code map to?".
// The docs generator consumes this, and httpError() reads `status` to
// pick the default response code.
export const ERROR_CODE_META: Record<ErrorCode, ErrorCodeMeta> = {
  // Validation / generic
  [ErrorCodes.VALIDATION_FAILED]: {
    status: 400,
    description: "Request payload failed schema validation; see fields[] for details.",
    group: "Validation",
  },
  [ErrorCodes.INVALID_PAYLOAD]: {
    status: 400,
    description: "Generic malformed input that didn't match a schema.",
    group: "Validation",
  },
  [ErrorCodes.INVALID_REQUEST]: {
    status: 400,
    description: "Generic invalid request (used when no more specific code applies).",
    group: "Validation",
  },
  [ErrorCodes.NOT_FOUND]: {
    status: 404,
    description: "The requested resource does not exist or the caller cannot see it.",
    group: "Validation",
  },
  [ErrorCodes.UNAUTHORIZED]: {
    status: 401,
    description: "Missing or invalid authentication.",
    group: "Validation",
  },
  [ErrorCodes.FORBIDDEN]: {
    status: 403,
    description: "Authenticated but not permitted to perform this action.",
    group: "Validation",
  },
  [ErrorCodes.RATE_LIMITED]: {
    status: 429,
    description: "Too many requests; back off and retry.",
    group: "Validation",
  },
  [ErrorCodes.INTERNAL_ERROR]: {
    status: 500,
    description: "Unexpected server error. Captured to Sentry.",
    group: "Validation",
  },
  [ErrorCodes.CONFLICT]: {
    status: 409,
    description: "Request conflicts with current resource state.",
    group: "Validation",
  },
  [ErrorCodes.ALREADY_EXISTS]: {
    status: 409,
    description: "Resource already exists (unique constraint conflict).",
    group: "Validation",
  },

  // Auth
  [ErrorCodes.EMAIL_REQUIRED]: {
    status: 400,
    description: "An email address is required for this authentication method.",
    group: "Auth",
  },
  [ErrorCodes.EMAIL_INVALID]: {
    status: 400,
    description: "The supplied email did not parse as a valid address.",
    group: "Auth",
  },
  [ErrorCodes.UNKNOWN_METHOD]: {
    status: 400,
    description: "The supplied authentication method is not recognised.",
    group: "Auth",
  },
  [ErrorCodes.INVALID_CHALLENGE]: {
    status: 400,
    description: "The auth challenge id does not exist.",
    group: "Auth",
  },
  [ErrorCodes.CHALLENGE_NOT_FOUND]: {
    status: 404,
    description: "The auth challenge could not be found.",
    group: "Auth",
  },
  [ErrorCodes.CHALLENGE_EXPIRED]: {
    status: 400,
    description: "The auth challenge has expired; start a new login.",
    group: "Auth",
  },
  [ErrorCodes.CHALLENGE_USED]: {
    status: 400,
    description: "The auth challenge has already been consumed.",
    group: "Auth",
  },
  [ErrorCodes.TOKEN_MISMATCH]: {
    status: 400,
    description: "The supplied magic-link / verification token did not match the challenge.",
    group: "Auth",
  },
  [ErrorCodes.INVALID_TOKEN]: {
    status: 400,
    description: "The supplied token is not valid for this challenge.",
    group: "Auth",
  },
  [ErrorCodes.REFRESH_TOKEN_INVALID]: {
    status: 401,
    description: "The refresh token was unknown, expired, or already revoked.",
    group: "Auth",
  },
  [ErrorCodes.REFRESH_TOKEN_REUSED]: {
    status: 401,
    description:
      "A previously-revoked refresh token was presented; all sessions for the user have been revoked.",
    group: "Auth",
  },
  [ErrorCodes.INVALID_REFRESH]: {
    status: 401,
    description: "Refresh failed (alias of refresh_token_invalid emitted by admin auth).",
    group: "Auth",
  },
  [ErrorCodes.INVALID_REFRESH_TOKEN]: {
    status: 401,
    description: "Refresh failed (alias of refresh_token_invalid emitted by consumer auth).",
    group: "Auth",
  },
  [ErrorCodes.DEV_LOGIN_DISABLED]: {
    status: 403,
    description: "Dev login is not enabled in this environment.",
    group: "Auth",
  },
  [ErrorCodes.DEV_USER_ID_REQUIRED]: {
    status: 400,
    description: "Dev login requires a devUserId in the payload.",
    group: "Auth",
  },
  [ErrorCodes.APPLE_NOT_CONFIGURED]: {
    status: 501,
    description: "Sign in with Apple is not configured for this deployment.",
    group: "Auth",
  },
  [ErrorCodes.APPLE_IDENTITY_TOKEN_REQUIRED]: {
    status: 400,
    description: "An appleIdentityToken is required for the Apple auth method.",
    group: "Auth",
  },
  [ErrorCodes.APPLE_VERIFICATION_FAILED]: {
    status: 401,
    description: "Apple identity token verification failed.",
    group: "Auth",
  },
  [ErrorCodes.APPLE_INVALID_SUB]: {
    status: 400,
    description: "Apple identity token did not carry a usable subject claim.",
    group: "Auth",
  },
  [ErrorCodes.APPLE_NONCE_REQUIRED]: {
    status: 400,
    description:
      "Sign in with Apple requires the client to send a per-request nonce when APPLE_NONCE_REQUIRED is on.",
    group: "Auth",
  },
  [ErrorCodes.APPLE_NONCE_MISMATCH]: {
    status: 401,
    description:
      "Apple identity token nonce claim did not match SHA-256 of the nonce supplied by the client.",
    group: "Auth",
  },
  [ErrorCodes.APPLE_EMAIL_UNVERIFIED]: {
    status: 400,
    description:
      "Apple identity token reports email_verified=false; new accounts require a verified email.",
    group: "Auth",
  },

  // Admin auth / 2FA
  [ErrorCodes.ADMIN_NOT_FOUND]: {
    status: 404,
    description: "Admin user does not exist.",
    group: "Admin",
  },
  [ErrorCodes.ADMIN_DISABLED]: {
    status: 403,
    description: "Admin user account is disabled.",
    group: "Admin",
  },
  [ErrorCodes.TWO_FACTOR_REQUIRED]: {
    status: 403,
    description: "This admin endpoint requires an elevated (2FA) session.",
    group: "Admin",
  },
  [ErrorCodes.TOTP_INVALID]: {
    status: 401,
    description: "The supplied TOTP code is not valid.",
    group: "Admin",
  },
  [ErrorCodes.INVALID_TOTP_CODE]: {
    status: 401,
    description: "The supplied TOTP code is not valid.",
    group: "Admin",
  },
  [ErrorCodes.RECOVERY_CODE_INVALID]: {
    status: 401,
    description: "The supplied TOTP recovery code is not valid or has been consumed.",
    group: "Admin",
  },
  [ErrorCodes.INVALID_RECOVERY_CODE]: {
    status: 401,
    description: "The supplied TOTP recovery code is not valid or has been consumed.",
    group: "Admin",
  },
  [ErrorCodes.TOTP_NOT_ENROLLED]: {
    status: 409,
    description: "TOTP has not been enrolled for this admin yet.",
    group: "Admin",
  },
  [ErrorCodes.TOTP_ALREADY_ENROLLED]: {
    status: 409,
    description:
      "TOTP is already enrolled; use /admin/auth/totp/reset (2FA-elevated) to replace the device.",
    group: "Admin",
  },
  [ErrorCodes.SESSION_MISSING_SID]: {
    status: 409,
    description:
      "Cannot elevate an admin session that lacks a session id; re-issue tokens via /auth/verify.",
    group: "Admin",
  },

  // Beta gates
  [ErrorCodes.INVITE_REQUIRED]: {
    status: 403,
    description: "Signups currently require a beta invite code.",
    group: "Beta gates",
  },
  [ErrorCodes.INVITE_CODE_REQUIRED]: {
    status: 400,
    description: "An invite code is required for this flow.",
    group: "Beta gates",
  },
  [ErrorCodes.INVITE_INVALID]: {
    status: 400,
    description: "The supplied invite code is unknown or malformed.",
    group: "Beta gates",
  },
  [ErrorCodes.INVITE_EXHAUSTED]: {
    status: 409,
    description: "The invite code has reached its maximum number of uses.",
    group: "Beta gates",
  },
  [ErrorCodes.INVITE_EXPIRED]: {
    status: 400,
    description: "The invite code has expired.",
    group: "Beta gates",
  },
  [ErrorCodes.INVITE_REVOKED]: {
    status: 400,
    description: "The invite code has been revoked.",
    group: "Beta gates",
  },
  [ErrorCodes.INVITE_RACE]: {
    status: 409,
    description: "Lost a race against another redemption of the same invite code.",
    group: "Beta gates",
  },
  [ErrorCodes.SIGNUPS_PAUSED]: {
    status: 503,
    description: "Operational kill-switch: new signups are paused.",
    group: "Beta gates",
  },
  [ErrorCodes.OUTSIDE_METRO]: {
    status: 451,
    description: "The declared location is outside every active beta metro.",
    group: "Beta gates",
  },
  [ErrorCodes.COUNTRY_NOT_SUPPORTED]: {
    status: 451,
    description:
      "OpenMatch is not available in the inferred country (sanctions, LGBTQ-safety, or unsupported launch geography).",
    group: "Beta gates",
  },

  // Profile / photos
  [ErrorCodes.UNDERAGE]: {
    status: 403,
    description: "The declared date of birth is under 18.",
    group: "Profile",
  },
  [ErrorCodes.INVALID_DOB]: {
    status: 400,
    description: "The supplied date of birth could not be parsed.",
    group: "Profile",
  },
  [ErrorCodes.PROFILE_NOT_FOUND]: {
    status: 404,
    description: "The caller does not yet have a Profile row.",
    group: "Profile",
  },
  [ErrorCodes.MAX_PHOTOS_REACHED]: {
    status: 400,
    description: "The profile already has the maximum number of photos.",
    group: "Profile",
  },
  [ErrorCodes.NO_FILE]: {
    status: 400,
    description: "The multipart upload did not include a file part.",
    group: "Profile",
  },
  [ErrorCodes.UNSUPPORTED_MEDIA_TYPE]: {
    status: 415,
    description: "The uploaded file's MIME type is not in the allowlist.",
    group: "Profile",
  },
  [ErrorCodes.PAYLOAD_TOO_LARGE]: {
    status: 413,
    description: "The uploaded file exceeds the size limit.",
    group: "Profile",
  },
  [ErrorCodes.PHOTO_NOT_FOUND]: {
    status: 404,
    description: "The photo id does not exist for this profile.",
    group: "Profile",
  },
  [ErrorCodes.PHOTO_NOT_OWNED]: {
    status: 400,
    description: "A photo id in the reorder payload does not belong to this profile.",
    group: "Profile",
  },
  [ErrorCodes.DUPLICATE_PHOTOS]: {
    status: 400,
    description: "The reorder payload contains duplicate photo ids.",
    group: "Profile",
  },
  [ErrorCodes.MIN_AGE_ABOVE_MAX]: {
    status: 400,
    description: "minAge cannot be greater than maxAge.",
    group: "Profile",
  },
  [ErrorCodes.UPLOAD_FAILED]: {
    status: 500,
    description: "Photo upload to blob storage failed.",
    group: "Profile",
  },
  [ErrorCodes.PHOTO_URL_TOKEN_INVALID]: {
    status: 401,
    description: "The photo-serve token is missing, malformed, or has a bad signature.",
    group: "Profile",
  },
  [ErrorCodes.PHOTO_URL_TOKEN_EXPIRED]: {
    status: 401,
    description: "The photo-serve token has expired; request a fresh URL.",
    group: "Profile",
  },

  // Discovery / swipe / match / chat
  [ErrorCodes.VIEWER_NOT_INITIALIZED]: {
    status: 400,
    description: "The viewer has no profile or preferences yet.",
    group: "Discovery",
  },
  [ErrorCodes.VIEWER_HAS_NO_LOCATION]: {
    status: 400,
    description: "The viewer has no recorded geographic location.",
    group: "Discovery",
  },
  [ErrorCodes.MISSING_LOCATION]: {
    status: 400,
    description: "Either the viewer or the candidate has no recorded location.",
    group: "Discovery",
  },
  [ErrorCodes.TARGET_NOT_FOUND]: {
    status: 404,
    description: "The target profile does not exist.",
    group: "Discovery",
  },
  [ErrorCodes.UNDO_NOT_AVAILABLE]: {
    status: 400,
    description: "The swipe cannot be undone (too old, already undone, or moderation locked).",
    group: "Discovery",
  },
  [ErrorCodes.MATCH_NOT_FOUND]: {
    status: 404,
    description: "The match id is unknown or the caller is not a participant.",
    group: "Discovery",
  },
  [ErrorCodes.CONVERSATION_NOT_FOUND]: {
    status: 404,
    description: "The conversation id is unknown.",
    group: "Discovery",
  },
  [ErrorCodes.NOT_PARTICIPANT]: {
    status: 403,
    description: "Caller is not a participant in this conversation.",
    group: "Discovery",
  },
  [ErrorCodes.USER_BLOCKED]: {
    status: 403,
    description: "Action blocked because one party has blocked the other.",
    group: "Discovery",
  },
  [ErrorCodes.ALREADY_BLOCKED]: {
    status: 409,
    description: "This user is already on the caller's block list.",
    group: "Discovery",
  },
  [ErrorCodes.EMPTY_MESSAGE]: {
    status: 400,
    description: "The chat message body is empty.",
    group: "Discovery",
  },
  [ErrorCodes.MESSAGE_TOO_LONG]: {
    status: 400,
    description: "The chat message body exceeds the length limit.",
    group: "Discovery",
  },
  [ErrorCodes.MESSAGE_REJECTED_BY_MODERATION]: {
    status: 422,
    description:
      "The configured ModerationProvider returned `block` for this message body; the message was not delivered.",
    group: "Discovery",
  },
  [ErrorCodes.PHOTO_REJECTED_BY_MODERATION]: {
    status: 422,
    description:
      "The configured ModerationProvider returned `block` for this image; the upload was rejected before persistence.",
    group: "Profile",
  },
  [ErrorCodes.CANNOT_BLOCK_SELF]: {
    status: 400,
    description: "A user cannot block themselves.",
    group: "Discovery",
  },
  [ErrorCodes.CANNOT_REPORT_SELF]: {
    status: 400,
    description: "A user cannot report themselves.",
    group: "Discovery",
  },

  // Realtime
  [ErrorCodes.REALTIME_UNCONFIGURED]: {
    status: 503,
    description: "Realtime backend (Ably) is not configured in this environment.",
    group: "Realtime",
  },

  // Safety / DSA / privacy
  [ErrorCodes.REPORT_NOT_FOUND]: {
    status: 404,
    description: "The report id is unknown.",
    group: "Safety",
  },
  [ErrorCodes.DSA_NOTICE_NOT_FOUND]: {
    status: 404,
    description: "The DSA notice id is unknown.",
    group: "Safety",
  },
  [ErrorCodes.POLICY_DOCUMENT_MISSING]: {
    status: 503,
    description: "No effective PolicyDocument is published for the requested scope.",
    group: "Safety",
  },
  [ErrorCodes.NO_ACTIVE_BAN]: {
    status: 404,
    description: "The user has no active ban to lift.",
    group: "Safety",
  },
  [ErrorCodes.NO_SCHEDULED_DELETION]: {
    status: 404,
    description: "No scheduled account deletion exists for this user.",
    group: "Safety",
  },
  [ErrorCodes.GRACE_PERIOD_EXPIRED]: {
    status: 410,
    description: "The deletion grace period has expired and cannot be cancelled.",
    group: "Safety",
  },
  [ErrorCodes.GRACE_PERIOD_NOT_YET_EXPIRED]: {
    status: 425,
    description: "The deletion grace period has not yet elapsed.",
    group: "Safety",
  },
  [ErrorCodes.NOT_AUTHORIZED]: {
    status: 403,
    description: "Caller is not authorised to act on this resource.",
    group: "Safety",
  },
  [ErrorCodes.ACCESS_REASON_REQUIRED]: {
    status: 412,
    description:
      "Reading this entity requires a sensitive-access grant; create one and pass accessGrantId.",
    group: "Safety",
  },

  // Admin
  [ErrorCodes.ADMIN_FORBIDDEN]: {
    status: 403,
    description: "Admin caller lacks the required permission.",
    group: "Admin",
  },
  [ErrorCodes.ADMIN_RBAC_DENIED]: {
    status: 403,
    description: "Admin RBAC denied this action; see `required` for the missing permission.",
    group: "Admin",
  },
  [ErrorCodes.ADMIN_USER_NOT_FOUND]: {
    status: 404,
    description: "The admin user id is unknown.",
    group: "Admin",
  },
  [ErrorCodes.ADMIN_ACTION_INVALID]: {
    status: 400,
    description: "The admin action requested is not valid in the current state.",
    group: "Admin",
  },
  [ErrorCodes.WOULD_LOCK_OUT_SYSTEM_ADMIN]: {
    status: 409,
    description: "Refusing to remove the last system_admin role from an active admin.",
    group: "Admin",
  },

  // Worker / internal
  [ErrorCodes.INTERNAL_TOKEN_INVALID]: {
    status: 401,
    description: "Internal worker token missing or wrong; cron endpoint refused.",
    group: "Internal",
  },

  // Misc
  [ErrorCodes.USER_NOT_FOUND]: {
    status: 404,
    description: "The user id is unknown.",
    group: "Misc",
  },
};

// Compile-time guarantee: every ErrorCode value has a meta entry.
// (If a code is added without meta, TypeScript will fail at build time
// because the Record<ErrorCode, ErrorCodeMeta> type is strict.)
const _exhaustivenessCheck: Record<ErrorCode, ErrorCodeMeta> = ERROR_CODE_META;
void _exhaustivenessCheck;
