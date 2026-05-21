import XCTest
@testable import OpenMatch

// PERF-I7 — Verify the device-class gating logic on `MatchCelebrationConfig`.
// `.current()` reads `ProcessInfo.thermalState` which we can't mutate in
// a unit test, so we verify the static tier definitions and the
// invariants that hold across tiers.
final class MatchCelebrationConfigTests: XCTestCase {
    func testFullTierHasMoreParticlesThanReduced() {
        XCTAssertGreaterThan(
            MatchCelebrationConfig.full.particleCount,
            MatchCelebrationConfig.reduced.particleCount
        )
    }

    func testReducedTierSkipsBlur() {
        // The blur filter on `Canvas` is the most expensive per-frame
        // op on older devices. Reduced tier must opt out.
        XCTAssertFalse(MatchCelebrationConfig.reduced.applyBlur)
        XCTAssertTrue(MatchCelebrationConfig.full.applyBlur)
    }

    func testReducedTierIsShorter() {
        XCTAssertLessThan(
            MatchCelebrationConfig.reduced.duration,
            MatchCelebrationConfig.full.duration
        )
    }

    func testSkipTierEmitsNoParticles() {
        XCTAssertEqual(MatchCelebrationConfig.skip.particleCount, 0)
        XCTAssertEqual(MatchCelebrationConfig.skip.tier, .skip)
    }

    func testCurrentReturnsSomeTier() {
        // The runtime selector must return something. The simulator
        // path returns `.full` (no model identifier means non-pre-A15);
        // on a real device this varies.
        let c = MatchCelebrationConfig.current()
        XCTAssertTrue(
            [.full, .reduced, .skip].contains(c.tier),
            "current() must pick a recognised tier"
        )
    }

    func testParticleCountSplitMatches() {
        // First + second stage counts must sum to particleCount.
        let full = MatchCelebrationConfig.full
        XCTAssertEqual(full.firstStageCount + full.secondStageCount, full.particleCount)
        let reduced = MatchCelebrationConfig.reduced
        XCTAssertEqual(reduced.firstStageCount + reduced.secondStageCount, reduced.particleCount)
    }
}
