import Foundation

// Lets MessageQueue (and any other caller that just needs to ship a
// message body) accept any type that satisfies the contract. The real
// APIClient already exposes the right method shape, so this is a
// retroactive conformance declaration with no implementation.
extension APIClient: MessageSending {}
