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
}
