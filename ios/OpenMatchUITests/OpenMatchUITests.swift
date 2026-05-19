import XCTest

final class OpenMatchUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunchesAndShowsWelcomeOrTabs() throws {
        let app = XCUIApplication()
        app.launch()

        // The app may show the Welcome screen (no cached credentials) or
        // jump straight to the Swipe tab (credentials in Keychain).
        // Either is a valid post-launch state — wait for EITHER, not both.
        let welcome = app.staticTexts["OpenMatch"]
        let swipeTab = app.tabBars.buttons["Swipe"]
        let deadline = Date(timeIntervalSinceNow: 30)
        while Date() < deadline {
            if welcome.exists || swipeTab.exists { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTFail("Neither the Welcome screen nor the Swipe tab appeared within 30 seconds")
    }

    // OPENMATCH_AUTO_LOGIN dev-logs the seed user u001 before the
    // first frame. We then verify that we land on the main tabs and
    // that the Swipe tab is selectable. This is the smoke path the
    // launch checklist references for TestFlight review sessions.
    func testAutoLoginLandsOnMainTabs() throws {
        let app = XCUIApplication()
        app.launchEnvironment["OPENMATCH_AUTO_LOGIN"] = "u001"
        app.launch()

        let swipeTab = app.tabBars.buttons["Swipe"]
        XCTAssertTrue(
            swipeTab.waitForExistence(timeout: 30),
            "Swipe tab did not appear after auto-login"
        )
        // The deck navigation title is "OpenMatch" (rendered in
        // Fraunces). It may be hidden behind the profile-completeness
        // banner; either the deck title or the banner CTA satisfies
        // the smoke test.
        let titleOrBanner = app.staticTexts["OpenMatch"].firstMatch
        let bannerCTA = app.buttons["Complete"].firstMatch
        XCTAssertTrue(
            titleOrBanner.waitForExistence(timeout: 10) || bannerCTA.exists,
            "Neither the Swipe deck title nor the profile-completeness CTA appeared"
        )
    }
}
