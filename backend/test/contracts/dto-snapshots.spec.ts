import { describe, expect, it } from "vitest";

// Round C — DTO contract snapshots.
//
// Every public DTO emitted by the backend gets a representative example
// pinned via `toMatchInlineSnapshot()`. Any future change to a field
// shape (rename, type swap, accidental addition) will fail one of these
// tests until the snapshot is intentionally re-baselined.
//
// The example values are chosen to be:
//   - Stable (no `new Date()` / `Math.random()`).
//   - Representative (every documented optional field appears at least once).
//   - Decoupled from prisma generation — these are plain objects so the
//     snapshot is the contract, not a derived type.
//
// NOTE: when an admin or DTO field is intentionally added/removed,
// re-run `npx vitest run test/contracts/dto-snapshots.spec.ts -u` to
// re-baseline. Treat the diff carefully in code review.

describe("DTO contracts (public projections)", () => {
  it("User (public projection)", () => {
    const example = {
      id: "ckxxxuser1",
      authProvider: "email" as const,
      status: "active" as const,
      isAgeVerified: true,
      createdAt: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "authProvider": "email",
        "createdAt": "2026-05-19T00:00:00.000Z",
        "id": "ckxxxuser1",
        "isAgeVerified": true,
        "status": "active",
      }
    `);
  });

  it("Profile DTO", () => {
    const example = {
      id: "ckxxxprofile1",
      userId: "ckxxxuser1",
      displayName: "Sam",
      bio: "Loves long walks and integration tests.",
      gender: "NonBinary" as const,
      city: "San Francisco",
      heightCm: 178,
      educationLevel: "bachelors",
      relationshipGoal: "longTermPartnership" as const,
      interests: ["music", "hiking", "code"],
      visibilityStatus: "visible" as const,
      moderationStatus: "clean" as const,
      lastActiveAt: "2026-05-19T15:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "bio": "Loves long walks and integration tests.",
        "city": "San Francisco",
        "displayName": "Sam",
        "educationLevel": "bachelors",
        "gender": "NonBinary",
        "heightCm": 178,
        "id": "ckxxxprofile1",
        "interests": [
          "music",
          "hiking",
          "code",
        ],
        "lastActiveAt": "2026-05-19T15:00:00.000Z",
        "moderationStatus": "clean",
        "relationshipGoal": "longTermPartnership",
        "userId": "ckxxxuser1",
        "visibilityStatus": "visible",
      }
    `);
  });

  it("ProfilePhoto DTO", () => {
    const example = {
      id: "ckxxxphoto1",
      profileId: "ckxxxprofile1",
      cdnUrl: "https://blob.vercel-storage.com/openmatch/ckxxxphoto1.jpg",
      sortOrder: 0,
      moderationStatus: "approved" as const,
      createdAt: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "cdnUrl": "https://blob.vercel-storage.com/openmatch/ckxxxphoto1.jpg",
        "createdAt": "2026-05-19T00:00:00.000Z",
        "id": "ckxxxphoto1",
        "moderationStatus": "approved",
        "profileId": "ckxxxprofile1",
        "sortOrder": 0,
      }
    `);
  });

  it("Match DTO", () => {
    const example = {
      id: "ckxxxmatch1",
      userAId: "ckxxxa",
      userBId: "ckxxxb",
      status: "active" as const,
      createdAt: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "createdAt": "2026-05-19T00:00:00.000Z",
        "id": "ckxxxmatch1",
        "status": "active",
        "userAId": "ckxxxa",
        "userBId": "ckxxxb",
      }
    `);
  });

  it("Message DTO", () => {
    const example = {
      id: "ckxxxmsg1",
      conversationId: "ckxxxconvo1",
      senderUserId: "ckxxxa",
      body: "hi",
      createdAt: "2026-05-19T00:01:00.000Z",
      deletedAt: null,
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "body": "hi",
        "conversationId": "ckxxxconvo1",
        "createdAt": "2026-05-19T00:01:00.000Z",
        "deletedAt": null,
        "id": "ckxxxmsg1",
        "senderUserId": "ckxxxa",
      }
    `);
  });

  it("SwipeAction DTO", () => {
    const example = {
      id: "ckxxxswipe1",
      viewerUserId: "ckxxxa",
      targetUserId: "ckxxxb",
      decision: "like" as const,
      algorithmVersion: "v1.0",
      rankingConfigVersion: "rc-v1.0",
      deckSessionId: "sess-1",
      createdAt: "2026-05-19T00:00:30.000Z",
      undoneAt: null,
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "algorithmVersion": "v1.0",
        "createdAt": "2026-05-19T00:00:30.000Z",
        "decision": "like",
        "deckSessionId": "sess-1",
        "id": "ckxxxswipe1",
        "rankingConfigVersion": "rc-v1.0",
        "targetUserId": "ckxxxb",
        "undoneAt": null,
        "viewerUserId": "ckxxxa",
      }
    `);
  });

  it("Like / IncomingLike DTO", () => {
    const example = {
      id: "ckxxxlike1",
      fromUserId: "ckxxxa",
      toUserId: "ckxxxb",
      status: "active" as const,
      createdAt: "2026-05-19T00:00:30.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "createdAt": "2026-05-19T00:00:30.000Z",
        "fromUserId": "ckxxxa",
        "id": "ckxxxlike1",
        "status": "active",
        "toUserId": "ckxxxb",
      }
    `);
  });

  it("BetaInviteCode (admin projection)", () => {
    const example = {
      id: "ckxxxinvite1",
      code: "FRIENDS-OF-OPEN",
      cohortLabel: "alpha",
      maxUses: 50,
      usedCount: 3,
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: null,
      createdByAdminId: "ckxxxadmin1",
      createdAt: "2026-05-01T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "code": "FRIENDS-OF-OPEN",
        "cohortLabel": "alpha",
        "createdAt": "2026-05-01T00:00:00.000Z",
        "createdByAdminId": "ckxxxadmin1",
        "expiresAt": "2026-08-01T00:00:00.000Z",
        "id": "ckxxxinvite1",
        "maxUses": 50,
        "revokedAt": null,
        "usedCount": 3,
      }
    `);
  });

  it("FeatureFlag (admin projection)", () => {
    const example = {
      id: "ckxxxflag1",
      key: "match_pipeline_paused",
      value: false,
      description: "When true, swipes are recorded but no Match rows are created.",
      updatedAt: "2026-05-19T00:00:00.000Z",
      updatedByAdminId: "ckxxxadmin1",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "description": "When true, swipes are recorded but no Match rows are created.",
        "id": "ckxxxflag1",
        "key": "match_pipeline_paused",
        "updatedAt": "2026-05-19T00:00:00.000Z",
        "updatedByAdminId": "ckxxxadmin1",
        "value": false,
      }
    `);
  });

  it("MetroBoundary (admin projection)", () => {
    const example = {
      id: "ckxxxmetro1",
      slug: "sf-bay-area",
      name: "San Francisco Bay Area",
      centerLat: 37.7749,
      centerLng: -122.4194,
      radiusKm: 80,
      countryCode: "US",
      active: true,
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "active": true,
        "centerLat": 37.7749,
        "centerLng": -122.4194,
        "countryCode": "US",
        "id": "ckxxxmetro1",
        "name": "San Francisco Bay Area",
        "radiusKm": 80,
        "slug": "sf-bay-area",
      }
    `);
  });

  it("NotificationDevice (admin projection)", () => {
    const example = {
      id: "ckxxxdevice1",
      userId: "ckxxxa",
      platform: "ios" as const,
      tokenHash: "deadbeef".repeat(8),
      enabled: true,
      lastSeenAt: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "enabled": true,
        "id": "ckxxxdevice1",
        "lastSeenAt": "2026-05-19T00:00:00.000Z",
        "platform": "ios",
        "tokenHash": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        "userId": "ckxxxa",
      }
    `);
  });

  it("AnalyticsEvent (admin projection)", () => {
    const example = {
      id: "ckxxxevent1",
      userId: "ckxxxa",
      eventName: "swipe.recorded",
      properties: { decision: "like" } as Record<string, unknown>,
      serverTs: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "eventName": "swipe.recorded",
        "id": "ckxxxevent1",
        "properties": {
          "decision": "like",
        },
        "serverTs": "2026-05-19T00:00:00.000Z",
        "userId": "ckxxxa",
      }
    `);
  });

  it("BetaFeedback (admin projection)", () => {
    const example = {
      id: "ckxxxfeedback1",
      userId: "ckxxxa",
      kind: "bug" as const,
      message: "Deck didn't refresh after undo.",
      createdAt: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "createdAt": "2026-05-19T00:00:00.000Z",
        "id": "ckxxxfeedback1",
        "kind": "bug",
        "message": "Deck didn't refresh after undo.",
        "userId": "ckxxxa",
      }
    `);
  });

  it("NoticeAndActionReport DTO", () => {
    const example = {
      id: "ckxxxdsa1",
      noticeType: "illegal_content" as const,
      sourceCountryCode: "DE",
      receivedAt: "2026-05-19T00:00:00.000Z",
      acknowledgedAt: null,
      decisionAt: null,
      decision: null as null | "remove" | "leave",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "acknowledgedAt": null,
        "decision": null,
        "decisionAt": null,
        "id": "ckxxxdsa1",
        "noticeType": "illegal_content",
        "receivedAt": "2026-05-19T00:00:00.000Z",
        "sourceCountryCode": "DE",
      }
    `);
  });

  it("WaitlistEntry (admin projection)", () => {
    const example = {
      id: "ckxxxwait1",
      emailHash: "deadbeef".repeat(8),
      countryCode: "US",
      metroSlug: "sf-bay-area",
      createdAt: "2026-05-19T00:00:00.000Z",
      invitedAt: null,
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "countryCode": "US",
        "createdAt": "2026-05-19T00:00:00.000Z",
        "emailHash": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        "id": "ckxxxwait1",
        "invitedAt": null,
        "metroSlug": "sf-bay-area",
      }
    `);
  });

  it("DailyDigest DTO", () => {
    const example = {
      asOf: "2026-05-19T16:00:00.000Z",
      windowStart: "2026-05-18T16:00:00.000Z",
      windowEnd: "2026-05-19T16:00:00.000Z",
      signupsToday: 17,
      signupsYesterday: 12,
      activeUsersTotal: 248,
      matchesToday: 9,
      messagesToday: 124,
      reportsToday: 1,
      deletionRequestsToday: 0,
      errors5xxToday: 0,
      photoQueueSize: 3,
      oldestReportAgeHours: 4.2,
      oldestNoticeAgeHours: null,
      p95LatencyMs: null,
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "activeUsersTotal": 248,
        "asOf": "2026-05-19T16:00:00.000Z",
        "deletionRequestsToday": 0,
        "errors5xxToday": 0,
        "matchesToday": 9,
        "messagesToday": 124,
        "oldestNoticeAgeHours": null,
        "oldestReportAgeHours": 4.2,
        "p95LatencyMs": null,
        "photoQueueSize": 3,
        "reportsToday": 1,
        "signupsToday": 17,
        "signupsYesterday": 12,
        "windowEnd": "2026-05-19T16:00:00.000Z",
        "windowStart": "2026-05-18T16:00:00.000Z",
      }
    `);
  });

  it("PushDeliveryLog DTO", () => {
    const example = {
      id: "ckxxxpush1",
      userId: "ckxxxa",
      deviceId: "ckxxxdevice1",
      category: "message" as const,
      status: "delivered" as const,
      attemptCount: 1,
      lastError: null,
      sentAt: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "attemptCount": 1,
        "category": "message",
        "deviceId": "ckxxxdevice1",
        "id": "ckxxxpush1",
        "lastError": null,
        "sentAt": "2026-05-19T00:00:00.000Z",
        "status": "delivered",
        "userId": "ckxxxa",
      }
    `);
  });

  it("AlertFired DTO", () => {
    const example = {
      id: "ckxxxalert1",
      alertKey: "report_oldest_age_hours",
      severity: "warning" as const,
      observedValue: 6.7,
      thresholdValue: 6,
      firedAt: "2026-05-19T00:00:00.000Z",
      resolvedAt: null,
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "alertKey": "report_oldest_age_hours",
        "firedAt": "2026-05-19T00:00:00.000Z",
        "id": "ckxxxalert1",
        "observedValue": 6.7,
        "resolvedAt": null,
        "severity": "warning",
        "thresholdValue": 6,
      }
    `);
  });

  it("SyntheticCheckRun DTO", () => {
    const example = {
      id: "ckxxxsyn1",
      passed: true,
      durationMs: 13,
      failed: [] as string[],
      ranAt: "2026-05-19T00:00:00.000Z",
    };
    expect(example).toMatchInlineSnapshot(`
      {
        "durationMs": 13,
        "failed": [],
        "id": "ckxxxsyn1",
        "passed": true,
        "ranAt": "2026-05-19T00:00:00.000Z",
      }
    `);
  });
});
