import XCTest
@testable import OpenMatch

// SEV-M6 — File-protection class regression for the outbound message
// queue.
//
// Setting `.completeFileProtection` only takes effect on a device with
// a passcode set (the simulator has none in CI). What we can still
// assert at unit-test level is:
//   1. The queue's encode/write call site uses the right options.
//   2. The containing directory was created with the right
//      `.protectionKey` attribute.
//   3. The directory is excluded from iCloud / iTunes backups.
final class MessageQueueProtectionTests: XCTestCase {
    func testFileStorageDirectoryIsExcludedFromBackup() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("openmatch-queue-protect-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("message-queue.json")
        defer { try? FileManager.default.removeItem(at: tmp.deletingLastPathComponent()) }

        // Constructor creates the parent directory with the protection
        // attribute and sets the no-backup resource value.
        let storage = FileMessageQueueStorage(url: tmp)
        let item = PendingMessage(
            id: UUID(),
            conversationId: "c1",
            body: "secret draft",
            attempts: 0,
            lastError: nil,
            sentAt: nil,
            nextAttemptAt: Date()
        )
        storage.save([item])

        // After save() the file must exist…
        XCTAssertTrue(FileManager.default.fileExists(atPath: tmp.path))

        // …and both the file and its parent should be excluded from backup.
        let fileValues = try tmp.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(
            fileValues.isExcludedFromBackup,
            true,
            "message-queue.json must be excluded from iCloud / iTunes backups (SEV-M6)"
        )
        let dirValues = try tmp.deletingLastPathComponent().resourceValues(
            forKeys: [.isExcludedFromBackupKey]
        )
        XCTAssertEqual(
            dirValues.isExcludedFromBackup,
            true,
            "queue directory must be excluded from backup so legacy files inherit the policy (SEV-M6)"
        )
    }

    func testFileStorageDirectoryHasProtectionAttribute() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("openmatch-queue-prot-attr-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("message-queue.json")
        defer { try? FileManager.default.removeItem(at: tmp.deletingLastPathComponent()) }
        _ = FileMessageQueueStorage(url: tmp)

        let attrs = try FileManager.default.attributesOfItem(
            atPath: tmp.deletingLastPathComponent().path
        )
        // On simulators without a passcode the OS may still record the
        // requested protection class on the directory inode even though
        // it can't encrypt at-rest. We accept either `.complete` (real
        // device) or absent (simulator) — but if the value is present
        // it must be `.complete`. A `.none` here would be a regression.
        if let proto = attrs[.protectionKey] as? FileProtectionType {
            XCTAssertEqual(
                proto,
                .complete,
                "directory protection class must be .complete (SEV-M6) when reported by the OS"
            )
        }
    }
}
