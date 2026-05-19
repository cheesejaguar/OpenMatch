import XCTest
@testable import OpenMatch

final class ProfileGateTests: XCTestCase {
    func testCompletenessDecodesFromBackendShape() throws {
        let json = """
        {
          "isComplete": false,
          "hasPhotos": false,
          "hasDisplayName": true,
          "isAgeVerified": true,
          "photoCount": 1
        }
        """.data(using: .utf8)!
        let dto = try JSONDecoder().decode(ProfileCompletenessDTO.self, from: json)
        XCTAssertFalse(dto.isComplete)
        XCTAssertFalse(dto.hasPhotos)
        XCTAssertEqual(dto.photoCount, 1)
    }

    @MainActor
    func testProfileGateFailsOpenOnError() async {
        // No api attached → refresh() is a no-op and isComplete stays
        // at the default `true`. This is the desired "fail open"
        // behaviour: a network blip never traps the user in the
        // completion screen, because the server-side discovery query
        // is the authoritative gate.
        let gate = ProfileGate()
        await gate.refresh()
        XCTAssertTrue(gate.isComplete)
        XCTAssertNil(gate.dto)
    }

    @MainActor
    func testCompletenessIncompleteWithFewerThanTwoPhotos() {
        // Mirrors the discovery filter: < 2 photos → incomplete.
        let incomplete = ProfileCompletenessDTO(
            isComplete: false,
            hasPhotos: false,
            hasDisplayName: true,
            isAgeVerified: true,
            photoCount: 1
        )
        XCTAssertFalse(incomplete.isComplete)
        XCTAssertEqual(incomplete.photoCount, 1)

        let complete = ProfileCompletenessDTO(
            isComplete: true,
            hasPhotos: true,
            hasDisplayName: true,
            isAgeVerified: true,
            photoCount: 3
        )
        XCTAssertTrue(complete.isComplete)
    }
}
