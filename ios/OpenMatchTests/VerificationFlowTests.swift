import XCTest
@testable import OpenMatch

// Trust & safety automation — sanity test for VerificationFlowModel
// stage transitions. The networking is exercised via integration tests
// against the backend; here we cover only the in-memory state machine.

@MainActor
final class VerificationFlowTests: XCTestCase {

    func testInitialStageIsIdle() async {
        let model = VerificationFlowModel(api: makeAPI())
        XCTAssertEqual(model.stage, .idle)
    }

    func testIdleStageIsEquatable() {
        XCTAssertEqual(VerificationFlowModel.Stage.idle, VerificationFlowModel.Stage.idle)
        XCTAssertNotEqual(
            VerificationFlowModel.Stage.idle,
            VerificationFlowModel.Stage.requestingChallenge
        )
    }

    func testAwaitingCaptureCarriesPromptAndNonce() {
        let stage: VerificationFlowModel.Stage = .awaitingCapture(
            prompt: "Hold up two fingers",
            nonce: "nonce-1234"
        )
        if case let .awaitingCapture(prompt, nonce) = stage {
            XCTAssertEqual(prompt, "Hold up two fingers")
            XCTAssertEqual(nonce, "nonce-1234")
        } else {
            XCTFail("expected awaitingCapture")
        }
    }

    func testSubmittingStageCarriesRequestId() {
        let stage: VerificationFlowModel.Stage = .submitted(requestId: "req-99")
        if case let .submitted(id) = stage {
            XCTAssertEqual(id, "req-99")
        } else {
            XCTFail("expected submitted")
        }
    }

    private func makeAPI() -> APIClient {
        APIClient(baseURL: URL(string: "https://example.local")!)
    }
}
