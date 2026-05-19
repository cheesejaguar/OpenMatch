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

    // Smoke test for the DEBUG-only OPENMATCH_AUTO_LOGIN launch arg.
    // We assert one of three legitimate end-states:
    //   1. Welcome screen — backend reachable but auto-login was refused
    //      (e.g. CI runs against production where ALLOW_DEV_LOGIN=false).
    //   2. Swipe tab — auto-login completed against a local dev backend.
    //   3. Onboarding step — auto-login completed but profile is incomplete.
    // The point is to verify the launch env doesn't crash the app and we
    // reach SOME post-launch surface; the success-path landing is covered
    // by the local screenshot scripts where backend availability is
    // controlled.
    func testAutoLoginLandsOnAReachableSurface() throws {
        let app = XCUIApplication()
        app.launchEnvironment["OPENMATCH_AUTO_LOGIN"] = "u001"
        app.launch()

        let welcome = app.staticTexts["OpenMatch"].firstMatch
        let swipeTab = app.tabBars.buttons["Swipe"]
        let continueButton = app.buttons["Continue"].firstMatch
        let deadline = Date(timeIntervalSinceNow: 30)
        while Date() < deadline {
            if welcome.exists || swipeTab.exists || continueButton.exists { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTFail("Auto-login app didn't reach Welcome / Swipe / Onboarding within 30 seconds")
    }
}
