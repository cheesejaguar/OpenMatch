import XCTest

final class OpenMatchUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunchesAndShowsWelcomeOrTabs() throws {
        let app = XCUIApplication()
        app.launch()
        // Wait for either the Welcome view or the swipe tab to be available,
        // depending on whether the keychain has cached credentials.
        let welcome = app.staticTexts["OpenMatch"]
        let swipeTab = app.tabBars.buttons["Swipe"]
        let predicate = NSPredicate(format: "exists == true")
        let exp = expectation(for: predicate, evaluatedWith: welcome, handler: nil)
        let exp2 = expectation(for: predicate, evaluatedWith: swipeTab, handler: nil)
        wait(for: [exp, exp2], timeout: 8, enforceOrder: false)
        XCTAssertTrue(welcome.exists || swipeTab.exists)
    }
}
