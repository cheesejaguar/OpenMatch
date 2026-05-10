import Foundation

enum APIConfig {
    static let defaultBaseURL: URL = {
        if let s = Bundle.main.object(forInfoDictionaryKey: "OMAPIBaseURL") as? String,
           let u = URL(string: s) {
            return u
        }
        return URL(string: "http://localhost:8080")!
    }()
}
