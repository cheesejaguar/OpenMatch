import Foundation

// Round B — typed mapping from backend error codes to APIError cases.
//
// The backend error registry lives in `backend/src/lib/error-codes.ts`
// and is the source of truth. When a code is added there, mirror it
// into APIError + the switch below + ErrorMessages.strings.
//
// Payload-bearing codes (outside_metro, country_not_supported) read
// their extra fields out of `body` here so call sites get a typed
// view of the payload rather than ad-hoc JSON parsing.

struct APIValidationField: Codable, Equatable {
    let path: String
    let message: String
    let code: String?
}

extension APIError {
    /// Build an APIError from a parsed backend error payload.
    ///
    /// `code` is the value of the top-level `error` field. `body` is
    /// the rest of the JSON object so payload-bearing codes can read
    /// extra fields without a second parse pass.
    static func from(status: Int, code: String, body: [String: Any]) -> APIError {
        switch code {
        // ---- Validation / generic ---------------------------------
        case "validation_failed":
            if let raw = body["fields"] as? [[String: Any]] {
                let fields = raw.compactMap { d -> APIValidationField? in
                    guard let path = d["path"] as? String,
                          let msg = d["message"] as? String else { return nil }
                    return APIValidationField(path: path, message: msg, code: d["code"] as? String)
                }
                return .validation(fields: fields)
            }
            return .validation(fields: [])
        case "invalid_payload", "invalid_request":
            return .validation(fields: [])
        case "rate_limited": return .rateLimited
        case "unauthorized": return .unauthorized
        case "forbidden": return .forbidden
        case "not_found": return .notFound
        case "conflict", "already_exists": return .conflict

        // ---- Auth -------------------------------------------------
        case "email_required": return .emailRequired
        case "email_invalid": return .emailInvalid
        case "unknown_method":
            return .unknown(code: code, status: status, message: body["message"] as? String)
        case "invalid_challenge", "challenge_not_found":
            return .challengeNotFound
        case "challenge_expired": return .challengeExpired
        case "challenge_used": return .challengeUsed
        case "token_mismatch", "invalid_token":
            return .tokenMismatch
        case "refresh_token_invalid", "invalid_refresh", "invalid_refresh_token":
            return .refreshTokenInvalid
        case "refresh_token_reused": return .refreshTokenReused
        case "dev_login_disabled": return .devLoginDisabled
        case "dev_user_id_required": return .devUserIdRequired
        case "apple_not_configured": return .appleNotConfigured
        case "apple_identity_token_required": return .appleIdentityTokenRequired
        case "apple_verification_failed", "apple_invalid_sub":
            return .appleVerificationFailed

        // ---- Admin auth / 2FA -------------------------------------
        case "admin_not_found": return .adminUserNotFound
        case "admin_disabled": return .adminForbidden
        case "two_factor_required": return .twoFactorRequired
        case "totp_invalid", "invalid_totp_code": return .totpInvalid
        case "recovery_code_invalid", "invalid_recovery_code": return .recoveryCodeInvalid
        case "totp_not_enrolled": return .totpNotEnrolled
        case "session_missing_sid":
            return .unknown(code: code, status: status, message: body["message"] as? String)

        // ---- Beta gates -------------------------------------------
        case "invite_required": return .inviteRequired
        case "invite_code_required": return .inviteRequired
        case "invite_invalid": return .inviteInvalid
        case "invite_exhausted": return .inviteExhausted
        case "invite_expired": return .inviteExpired
        case "invite_revoked": return .inviteRevoked
        case "invite_race": return .conflict
        case "signups_paused": return .signupsPaused
        case "outside_metro":
            let km = (body["nearestKm"] as? Double)
                ?? (body["nearestKm"] as? Int).map(Double.init)
            return .outsideMetro(nearestKm: km)
        case "country_not_supported":
            return .countryNotSupported(
                reason: body["reason"] as? String,
                note: body["note"] as? String
            )

        // ---- Profile / photos -------------------------------------
        case "underage": return .underage
        case "invalid_dob": return .invalidDob
        case "profile_not_found": return .profileNotFound
        case "max_photos_reached": return .maxPhotosReached
        case "no_file": return .noFile
        case "unsupported_media_type": return .unsupportedMediaType
        case "payload_too_large": return .payloadTooLarge
        case "photo_not_found": return .photoNotFound
        case "photo_not_owned": return .photoNotOwned
        case "duplicate_photos": return .duplicatePhotos
        case "min_age_above_max": return .minAgeAboveMax
        case "upload_failed":
            return .unknown(code: code, status: status, message: body["message"] as? String)

        // ---- Discovery / swipe / match / chat ---------------------
        case "viewer_not_initialized", "viewer_has_no_location", "missing_location":
            return .unknown(code: code, status: status, message: body["message"] as? String)
        case "target_not_found": return .targetNotFound
        case "undo_not_available": return .undoNotAvailable
        case "match_not_found": return .matchNotFound
        case "conversation_not_found": return .conversationNotFound
        case "not_participant": return .notParticipant
        case "user_blocked": return .userBlocked
        case "already_blocked": return .alreadyBlocked
        case "empty_message", "message_too_long",
             "cannot_block_self", "cannot_report_self":
            return .unknown(code: code, status: status, message: body["message"] as? String)

        // ---- Realtime --------------------------------------------
        case "realtime_unconfigured": return .realtimeUnconfigured

        // ---- Safety / DSA / privacy ------------------------------
        case "report_not_found": return .reportNotFound
        case "dsa_notice_not_found": return .dsaNoticeNotFound
        case "policy_document_missing",
             "no_active_ban",
             "no_scheduled_deletion",
             "grace_period_expired",
             "grace_period_not_yet_expired",
             "not_authorized",
             "access_reason_required":
            return .unknown(code: code, status: status, message: body["message"] as? String)

        // ---- Admin -----------------------------------------------
        case "admin_forbidden": return .adminForbidden
        case "admin_rbac_denied": return .adminRbacDenied
        case "admin_user_not_found": return .adminUserNotFound
        case "admin_action_invalid": return .adminActionInvalid
        case "would_lock_out_system_admin": return .conflict

        // ---- Worker / internal -----------------------------------
        case "internal_token_invalid": return .unauthorized

        // ---- Misc ------------------------------------------------
        case "user_not_found": return .userNotFound

        default:
            return .unknown(code: code, status: status, message: body["message"] as? String)
        }
    }

    /// Convenience for tests + the APIClient: parse a raw response body
    /// and HTTP status into a typed APIError.
    static func decode(data: Data, status: Int) -> APIError {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let code = json["error"] as? String {
            return APIError.from(status: status, code: code, body: json)
        }
        return .http(status: status, message: String(data: data, encoding: .utf8))
    }
}

// Test-only helper exposed at module scope so OpenMatchTests can call
// it without crossing the @MainActor isolation boundary on APIClient.
// Kept here (rather than on APIClient) because the decode logic is
// pure and doesn't touch any client state.
enum APIClientTestSupport {
    static func decodeError(data: Data, status: Int) -> APIError {
        APIError.decode(data: data, status: status)
    }
}

extension APIClient {
    /// Wrapper that forwards to APIClientTestSupport.decodeError so
    /// tests can call APIClient.testDecodeError without the actor hop.
    nonisolated static func testDecodeError(data: Data, status: Int) -> APIError {
        APIClientTestSupport.decodeError(data: data, status: status)
    }
}
