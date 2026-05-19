import XCTest
@testable import OpenMatch

final class InviteCodeTests: XCTestCase {
    func testParsesInviteFromUniversalLink() {
        let url = URL(string: "https://openmatch.app/welcome?invite=sf-week1-abc")!
        XCTAssertEqual(WelcomeView.parseInviteCode(from: url), "SF-WEEK1-ABC")
    }

    func testParsesInviteFromCustomScheme() {
        let url = URL(string: "openmatch://?invite=foo")!
        XCTAssertEqual(WelcomeView.parseInviteCode(from: url), "FOO")
    }

    func testReturnsNilWhenInviteMissing() {
        XCTAssertNil(WelcomeView.parseInviteCode(from: URL(string: "https://openmatch.app/")!))
        XCTAssertNil(WelcomeView.parseInviteCode(from: URL(string: "https://openmatch.app/?x=1")!))
    }

    func testTrimsAndNormalizesWhitespace() {
        let url = URL(string: "https://openmatch.app/?invite=%20abc%20")!
        XCTAssertEqual(WelcomeView.parseInviteCode(from: url), "ABC")
    }

    func testEmptyInviteParameterIsNil() {
        let url = URL(string: "https://openmatch.app/?invite=")!
        XCTAssertNil(WelcomeView.parseInviteCode(from: url))
    }

    func testEmailDomainExtraction() {
        XCTAssertEqual(WelcomeView.emailDomain("dev@Example.COM"), "example.com")
        XCTAssertEqual(WelcomeView.emailDomain("noatsign"), "")
    }

    func testStartLoginRequestSerializesInviteCode() throws {
        let req = StartLoginRequest(
            method: "email",
            email: "person@example.com",
            appleIdentityToken: nil,
            devUserId: nil,
            inviteCode: "ABC-123"
        )
        let data = try JSONEncoder().encode(req)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["inviteCode"] as? String, "ABC-123")
    }
}
