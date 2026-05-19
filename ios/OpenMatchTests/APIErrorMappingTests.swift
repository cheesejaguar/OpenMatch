import XCTest
@testable import OpenMatch

// Round B — verifies that every backend ErrorCodes value decodes into
// the right typed APIError case. Adding a new code to the registry in
// backend/src/lib/error-codes.ts MUST be paired with a new assertion
// here so the iOS client never silently falls through to .unknown.

final class APIErrorMappingTests: XCTestCase {
    private func decode(_ jsonString: String, status: Int = 400) -> APIError {
        let body = Data(jsonString.utf8)
        return APIClient.testDecodeError(data: body, status: status)
    }

    // MARK: - Validation / generic

    func test_validation_failed_carries_fields() throws {
        let err = decode(#"{"error":"validation_failed","fields":[{"path":"email","message":"required"}]}"#)
        if case .validation(let fields) = err {
            XCTAssertEqual(fields.first?.path, "email")
            XCTAssertEqual(fields.first?.message, "required")
        } else {
            XCTFail("expected .validation, got \(err)")
        }
    }

    func test_validation_failed_with_no_fields() {
        XCTAssertEqual(decode(#"{"error":"validation_failed"}"#), .validation(fields: []))
    }

    func test_rate_limited() {
        XCTAssertEqual(decode(#"{"error":"rate_limited"}"#, status: 429), .rateLimited)
    }

    func test_unauthorized() {
        XCTAssertEqual(decode(#"{"error":"unauthorized"}"#, status: 401), .unauthorized)
    }

    func test_forbidden() {
        XCTAssertEqual(decode(#"{"error":"forbidden"}"#, status: 403), .forbidden)
    }

    func test_not_found() {
        XCTAssertEqual(decode(#"{"error":"not_found"}"#, status: 404), .notFound)
    }

    func test_conflict() {
        XCTAssertEqual(decode(#"{"error":"conflict"}"#, status: 409), .conflict)
        XCTAssertEqual(decode(#"{"error":"already_exists"}"#, status: 409), .conflict)
    }

    // MARK: - Auth / 2FA

    func test_email_required() {
        XCTAssertEqual(decode(#"{"error":"email_required"}"#), .emailRequired)
    }

    func test_email_invalid() {
        XCTAssertEqual(decode(#"{"error":"email_invalid"}"#), .emailInvalid)
    }

    func test_challenge_codes() {
        XCTAssertEqual(decode(#"{"error":"challenge_not_found"}"#), .challengeNotFound)
        XCTAssertEqual(decode(#"{"error":"invalid_challenge"}"#), .challengeNotFound)
        XCTAssertEqual(decode(#"{"error":"challenge_expired"}"#), .challengeExpired)
        XCTAssertEqual(decode(#"{"error":"challenge_used"}"#), .challengeUsed)
        XCTAssertEqual(decode(#"{"error":"token_mismatch"}"#), .tokenMismatch)
        XCTAssertEqual(decode(#"{"error":"invalid_token"}"#), .tokenMismatch)
    }

    func test_refresh_codes() {
        XCTAssertEqual(decode(#"{"error":"refresh_token_invalid"}"#, status: 401), .refreshTokenInvalid)
        XCTAssertEqual(decode(#"{"error":"invalid_refresh"}"#, status: 401), .refreshTokenInvalid)
        XCTAssertEqual(decode(#"{"error":"invalid_refresh_token"}"#, status: 401), .refreshTokenInvalid)
        XCTAssertEqual(decode(#"{"error":"refresh_token_reused"}"#, status: 401), .refreshTokenReused)
    }

    func test_dev_login_codes() {
        XCTAssertEqual(decode(#"{"error":"dev_login_disabled"}"#, status: 403), .devLoginDisabled)
        XCTAssertEqual(decode(#"{"error":"dev_user_id_required"}"#), .devUserIdRequired)
    }

    func test_apple_codes() {
        XCTAssertEqual(decode(#"{"error":"apple_not_configured"}"#, status: 501), .appleNotConfigured)
        XCTAssertEqual(decode(#"{"error":"apple_identity_token_required"}"#), .appleIdentityTokenRequired)
        XCTAssertEqual(decode(#"{"error":"apple_verification_failed"}"#, status: 401), .appleVerificationFailed)
        XCTAssertEqual(decode(#"{"error":"apple_invalid_sub"}"#), .appleVerificationFailed)
    }

    func test_totp_codes() {
        XCTAssertEqual(decode(#"{"error":"two_factor_required"}"#, status: 403), .twoFactorRequired)
        XCTAssertEqual(decode(#"{"error":"totp_invalid"}"#, status: 401), .totpInvalid)
        XCTAssertEqual(decode(#"{"error":"invalid_totp_code"}"#, status: 401), .totpInvalid)
        XCTAssertEqual(decode(#"{"error":"recovery_code_invalid"}"#, status: 401), .recoveryCodeInvalid)
        XCTAssertEqual(decode(#"{"error":"invalid_recovery_code"}"#, status: 401), .recoveryCodeInvalid)
        XCTAssertEqual(decode(#"{"error":"totp_not_enrolled"}"#, status: 409), .totpNotEnrolled)
    }

    // MARK: - Beta gates

    func test_invite_required_maps_to_typed_case() throws {
        let body = Data(#"{"error":"invite_required"}"#.utf8)
        let err = APIClient.testDecodeError(data: body, status: 403)
        XCTAssertEqual(err, .inviteRequired)
    }

    func test_invite_code_required_maps_to_invite_required() {
        XCTAssertEqual(decode(#"{"error":"invite_code_required"}"#), .inviteRequired)
    }

    func test_invite_invalid() {
        XCTAssertEqual(decode(#"{"error":"invite_invalid"}"#), .inviteInvalid)
    }

    func test_invite_exhausted() {
        XCTAssertEqual(decode(#"{"error":"invite_exhausted"}"#, status: 409), .inviteExhausted)
    }

    func test_invite_expired() {
        XCTAssertEqual(decode(#"{"error":"invite_expired"}"#), .inviteExpired)
    }

    func test_invite_revoked() {
        XCTAssertEqual(decode(#"{"error":"invite_revoked"}"#), .inviteRevoked)
    }

    func test_invite_race_maps_to_conflict() {
        XCTAssertEqual(decode(#"{"error":"invite_race"}"#, status: 409), .conflict)
    }

    func test_signups_paused() {
        XCTAssertEqual(decode(#"{"error":"signups_paused"}"#, status: 503), .signupsPaused)
    }

    func test_outside_metro_carries_payload() throws {
        let body = Data(#"{"error":"outside_metro","nearestKm":42.3}"#.utf8)
        let err = APIClient.testDecodeError(data: body, status: 451)
        XCTAssertEqual(err, .outsideMetro(nearestKm: 42.3))
    }

    func test_outside_metro_without_payload() {
        XCTAssertEqual(
            decode(#"{"error":"outside_metro"}"#, status: 451),
            .outsideMetro(nearestKm: nil)
        )
    }

    func test_country_not_supported_carries_payload() {
        let err = decode(
            #"{"error":"country_not_supported","reason":"sanctions","note":"Try again later"}"#,
            status: 451
        )
        XCTAssertEqual(
            err,
            .countryNotSupported(reason: "sanctions", note: "Try again later")
        )
    }

    // MARK: - Profile / photos

    func test_profile_photos_codes() {
        XCTAssertEqual(decode(#"{"error":"underage"}"#, status: 403), .underage)
        XCTAssertEqual(decode(#"{"error":"invalid_dob"}"#), .invalidDob)
        XCTAssertEqual(decode(#"{"error":"profile_not_found"}"#, status: 404), .profileNotFound)
        XCTAssertEqual(decode(#"{"error":"max_photos_reached"}"#), .maxPhotosReached)
        XCTAssertEqual(decode(#"{"error":"no_file"}"#), .noFile)
        XCTAssertEqual(decode(#"{"error":"unsupported_media_type"}"#, status: 415), .unsupportedMediaType)
        XCTAssertEqual(decode(#"{"error":"payload_too_large"}"#, status: 413), .payloadTooLarge)
        XCTAssertEqual(decode(#"{"error":"photo_not_found"}"#, status: 404), .photoNotFound)
        XCTAssertEqual(decode(#"{"error":"photo_not_owned"}"#), .photoNotOwned)
        XCTAssertEqual(decode(#"{"error":"duplicate_photos"}"#), .duplicatePhotos)
        XCTAssertEqual(decode(#"{"error":"min_age_above_max"}"#), .minAgeAboveMax)
    }

    // MARK: - Discovery / swipe / match / chat

    func test_discovery_codes() {
        XCTAssertEqual(decode(#"{"error":"target_not_found"}"#, status: 404), .targetNotFound)
        XCTAssertEqual(decode(#"{"error":"undo_not_available"}"#), .undoNotAvailable)
        XCTAssertEqual(decode(#"{"error":"match_not_found"}"#, status: 404), .matchNotFound)
        XCTAssertEqual(decode(#"{"error":"conversation_not_found"}"#, status: 404), .conversationNotFound)
        XCTAssertEqual(decode(#"{"error":"not_participant"}"#, status: 403), .notParticipant)
        XCTAssertEqual(decode(#"{"error":"user_blocked"}"#, status: 403), .userBlocked)
        XCTAssertEqual(decode(#"{"error":"already_blocked"}"#, status: 409), .alreadyBlocked)
    }

    // MARK: - Realtime / safety / admin

    func test_realtime_unconfigured() {
        XCTAssertEqual(decode(#"{"error":"realtime_unconfigured"}"#, status: 503), .realtimeUnconfigured)
    }

    func test_safety_codes() {
        XCTAssertEqual(decode(#"{"error":"report_not_found"}"#, status: 404), .reportNotFound)
        XCTAssertEqual(decode(#"{"error":"dsa_notice_not_found"}"#, status: 404), .dsaNoticeNotFound)
    }

    func test_admin_codes() {
        XCTAssertEqual(decode(#"{"error":"admin_forbidden"}"#, status: 403), .adminForbidden)
        XCTAssertEqual(decode(#"{"error":"admin_rbac_denied"}"#, status: 403), .adminRbacDenied)
        XCTAssertEqual(decode(#"{"error":"admin_user_not_found"}"#, status: 404), .adminUserNotFound)
        XCTAssertEqual(decode(#"{"error":"admin_action_invalid"}"#), .adminActionInvalid)
        XCTAssertEqual(decode(#"{"error":"would_lock_out_system_admin"}"#, status: 409), .conflict)
    }

    // MARK: - Misc / catch-alls

    func test_user_not_found() {
        XCTAssertEqual(decode(#"{"error":"user_not_found"}"#, status: 404), .userNotFound)
    }

    func test_unknown_code_falls_through_to_unknown_case() {
        let err = decode(#"{"error":"some_brand_new_code","message":"hi"}"#, status: 418)
        XCTAssertEqual(
            err,
            .unknown(code: "some_brand_new_code", status: 418, message: "hi")
        )
    }

    func test_non_json_body_falls_back_to_http() {
        let body = Data("<html>nope</html>".utf8)
        let err = APIClient.testDecodeError(data: body, status: 502)
        XCTAssertEqual(err, .http(status: 502, message: "<html>nope</html>"))
    }

    func test_empty_body_falls_back_to_http() {
        let err = APIClient.testDecodeError(data: Data(), status: 500)
        XCTAssertEqual(err, .http(status: 500, message: ""))
    }

    // MARK: - LocalizedError fallback (no .strings bundle in tests)

    func test_invite_required_has_localised_description() {
        let err = APIError.inviteRequired
        XCTAssertNotNil(err.errorDescription)
        XCTAssertFalse(err.errorDescription!.isEmpty)
    }

    func test_unknown_carries_message_through_to_description() {
        let err = APIError.unknown(code: "foo", status: 400, message: "boom")
        XCTAssertTrue(err.errorDescription?.contains("boom") ?? false)
    }
}
