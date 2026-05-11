import type {
  AdminUserRecord,
  AuditEvent,
  Conversation,
  InternalNote,
  Message,
  Photo,
  Report,
  UserBan,
  UserRecord,
} from "./types";

type Store = {
  adminUsers: Map<string, AdminUserRecord>;
  users: Map<string, UserRecord>;
  conversations: Map<string, Conversation>;
  messages: Map<string, Message>;
  reports: Map<string, Report>;
  bans: Map<string, UserBan>;
  notes: Map<string, InternalNote>;
  actions: Map<string, unknown>;
  audit: Map<string, AuditEvent>;
  grants: Map<string, unknown>;
};

function isoDaysAgo(d: number): string {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}
function isoMinutesAgo(m: number): string {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}
function age(dob: string): number {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}
function maskedHash(prefix: string): string {
  return `${prefix}_••••${Math.random().toString(36).slice(2, 6)}`;
}

function makePhoto(i: number, mod: Photo["moderationStatus"] = "clean"): Photo {
  return {
    id: `photo_${i}_${Math.random().toString(36).slice(2, 8)}`,
    storageKey: `s3://om-prod-photos/seed/${i}.jpg`,
    cdnUrl: `https://images.unsplash.com/photo-${1500000000000 + i * 1357}?auto=format&fit=crop&w=600&q=60`,
    sortOrder: i,
    moderationStatus: mod,
    width: 1080,
    height: 1350,
    createdAt: isoDaysAgo(60 - i),
  };
}

export function seed(s: Store): void {
  // ---- Admin users (Phase 0 demo accounts) ----
  const admins: AdminUserRecord[] = [
    {
      id: "admin_viewer",
      email: "viewer@openmatch.dev",
      displayName: "Viewer Vee",
      status: "active",
      roles: ["viewer"],
      createdAt: isoDaysAgo(120),
      lastLoginAt: isoDaysAgo(2),
    },
    {
      id: "admin_mod",
      email: "mod@openmatch.dev",
      displayName: "Moderator Mira",
      status: "active",
      roles: ["moderator"],
      createdAt: isoDaysAgo(110),
      lastLoginAt: isoDaysAgo(0),
    },
    {
      id: "admin_senior",
      email: "senior@openmatch.dev",
      displayName: "Senior Sam",
      status: "active",
      roles: ["senior_moderator"],
      createdAt: isoDaysAgo(95),
      lastLoginAt: isoDaysAgo(0),
    },
    {
      id: "admin_ts",
      email: "ts-admin@openmatch.dev",
      displayName: "T&S Tasha",
      status: "active",
      roles: ["trust_safety_admin"],
      createdAt: isoDaysAgo(80),
      lastLoginAt: isoDaysAgo(0),
    },
    {
      id: "admin_sys",
      email: "sysadmin@openmatch.dev",
      displayName: "Sys Sage",
      status: "active",
      roles: ["system_admin"],
      createdAt: isoDaysAgo(140),
      lastLoginAt: isoDaysAgo(1),
    },
    {
      id: "admin_audit",
      email: "auditor@openmatch.dev",
      displayName: "Audit Ada",
      status: "active",
      roles: ["auditor"],
      createdAt: isoDaysAgo(40),
      lastLoginAt: isoDaysAgo(3),
    },
  ];
  admins.forEach((a) => s.adminUsers.set(a.id, a));

  // ---- Consumer users ----
  const baseProfiles: Array<Partial<UserRecord> & {
    displayName: string;
    gender: string;
    dob: string;
    bio: string;
  }> = [
    {
      displayName: "Aaron P.",
      gender: "Man",
      dob: "1992-04-12",
      bio: "Software engineer who likes hiking and bouldering.",
      city: "Brooklyn",
      region: "NY",
      country: "US",
      college: "NYU",
      jobTitle: "Software Engineer",
      relationshipGoal: "LongTerm",
      interests: ["hiking", "bouldering", "indie music"],
    },
    {
      displayName: "Bea L.",
      gender: "Woman",
      dob: "1996-09-22",
      bio: "Pediatric nurse, dog mom to Pebble.",
      city: "Oakland",
      region: "CA",
      country: "US",
      college: "UC Davis",
      jobTitle: "Pediatric Nurse",
      relationshipGoal: "LifePartner",
      interests: ["dogs", "running", "cooking"],
    },
    {
      displayName: "Cy M.",
      gender: "NonBinary",
      dob: "1998-01-30",
      bio: "Designer + DJ. Coffee maximalist.",
      city: "Austin",
      region: "TX",
      country: "US",
      college: "RISD",
      jobTitle: "Product Designer",
      relationshipGoal: "ShortTerm",
      interests: ["design", "djing", "coffee", "vinyl"],
    },
    {
      displayName: "Dani R.",
      gender: "Woman",
      dob: "1990-11-04",
      bio: "Lawyer by day, oil painter by night.",
      city: "Chicago",
      region: "IL",
      country: "US",
      college: "U. Chicago",
      jobTitle: "Attorney",
      relationshipGoal: "Marriage",
      interests: ["painting", "museums", "cycling"],
    },
    {
      displayName: "Eli K.",
      gender: "Man",
      dob: "1987-06-18",
      bio: "Father of two. Marathoner.",
      city: "Seattle",
      region: "WA",
      country: "US",
      college: "UW",
      jobTitle: "Architect",
      relationshipGoal: "LongTerm",
      interests: ["running", "kids", "architecture"],
    },
    {
      displayName: "Faye T.",
      gender: "TransWoman",
      dob: "1994-03-09",
      bio: "Chef, climber, writer. Chronic over-orderer.",
      city: "Portland",
      region: "OR",
      country: "US",
      college: "Reed",
      jobTitle: "Sous Chef",
      relationshipGoal: "Casual",
      interests: ["cooking", "climbing", "writing"],
    },
    {
      displayName: "Gus N.",
      gender: "Man",
      dob: "1985-12-01",
      bio: "DM me on telegram for crypto signals 🚀💰",
      city: "Miami",
      region: "FL",
      country: "US",
      jobTitle: "Investor",
      relationshipGoal: "Casual",
      interests: ["crypto", "yachts"],
    },
    {
      displayName: "Hana O.",
      gender: "Woman",
      dob: "1999-07-25",
      bio: "Grad student in marine bio. Likes tide pools.",
      city: "San Diego",
      region: "CA",
      country: "US",
      college: "Scripps",
      jobTitle: "Grad Student",
      relationshipGoal: "Friendship",
      interests: ["ocean", "diving", "research"],
    },
  ];

  const users: UserRecord[] = baseProfiles.map((p, i) => {
    const id = `user_${String(i + 1).padStart(3, "0")}`;
    const profileId = `profile_${String(i + 1).padStart(3, "0")}`;
    const photos = [makePhoto(i * 3 + 1), makePhoto(i * 3 + 2), makePhoto(i * 3 + 3)];
    if (i === 6) photos[0]!.moderationStatus = "under_review";
    return {
      id,
      profileId,
      status: i === 6 ? "active" : "active",
      createdAt: isoDaysAgo(120 - i * 8),
      lastActiveAt: isoMinutesAgo(i * 30 + 5),
      emailHashedDisplay: maskedHash("sha256"),
      phoneHashedDisplay: i % 3 === 0 ? maskedHash("phn") : null,
      dateOfBirth: p.dob,
      age: age(p.dob),
      displayName: p.displayName,
      gender: p.gender,
      pronouns: p.gender === "NonBinary" ? "they/them" : p.gender === "Woman" ? "she/her" : "he/him",
      bio: p.bio,
      city: p.city ?? null,
      region: p.region ?? null,
      country: p.country ?? null,
      heightCm: 160 + (i * 7) % 30,
      college: p.college ?? null,
      educationLevel: "Bachelor",
      jobTitle: p.jobTitle ?? null,
      company: null,
      relationshipGoal: p.relationshipGoal ?? null,
      drinking: i % 2 === 0 ? "socially" : "rarely",
      smoking: "never",
      exercise: "regularly",
      diet: i === 5 ? "vegetarian" : "no restrictions",
      religion: null,
      interests: p.interests ?? [],
      prompts: [
        { question: "A perfect Sunday is...", answer: "coffee, a long walk, and good company." },
        { question: "I'm looking for...", answer: "someone curious, kind, and direct." },
      ],
      verificationStatus: i % 2 === 0 ? "verified" : "unverified",
      visibilityStatus: "visible",
      moderationStatus: i === 6 ? "under_review" : "clean",
      photos,
      preferences: {
        minAge: 24,
        maxAge: 38,
        maxDistanceKm: 40,
        interestedGenders: ["Woman", "NonBinary"],
        relationshipGoals: ["LongTerm", "LifePartner"],
      },
    };
  });
  users.forEach((u) => s.users.set(u.id, u));

  // ---- Conversations and messages ----
  const convoSeeds: Array<{ a: string; b: string; msgs: { from: 0 | 1; body: string; mins: number }[] }> = [
    {
      a: "user_001",
      b: "user_002",
      msgs: [
        { from: 0, body: "Hi Bea! Loved your dog photos.", mins: 600 },
        { from: 1, body: "Thanks! Pebble says hi 🐶", mins: 595 },
        { from: 0, body: "What part of the bay are you in?", mins: 540 },
        { from: 1, body: "Oakland near Lake Merritt.", mins: 535 },
      ],
    },
    {
      a: "user_007",
      b: "user_004",
      msgs: [
        {
          from: 0,
          body: "Hey beautiful, I'm running a private trading group with guaranteed 10x returns.",
          mins: 90,
        },
        { from: 1, body: "Not interested.", mins: 85 },
        { from: 0, body: "Add me on telegram @gusinvests, you'll regret missing this", mins: 80 },
        { from: 0, body: "Last chance, just need your email and a small deposit.", mins: 75 },
      ],
    },
    {
      a: "user_003",
      b: "user_006",
      msgs: [
        { from: 0, body: "Loved your record collection in pic 2.", mins: 1500 },
        { from: 1, body: "Thanks! What's your last vinyl pickup?", mins: 1490 },
        { from: 0, body: "Some early Aphex Twin reissues.", mins: 1480 },
      ],
    },
    {
      a: "user_005",
      b: "user_008",
      msgs: [
        { from: 0, body: "How was the dive trip?", mins: 4000 },
        { from: 1, body: "Amazing! Saw a leopard shark.", mins: 3995 },
      ],
    },
  ];

  convoSeeds.forEach((c, ci) => {
    const conversationId = `convo_${String(ci + 1).padStart(3, "0")}`;
    const matchId = `match_${String(ci + 1).padStart(3, "0")}`;
    s.conversations.set(conversationId, {
      id: conversationId,
      matchId,
      participantUserIds: [c.a, c.b],
      createdAt: isoDaysAgo(20 - ci),
      status: "active",
    });
    c.msgs.forEach((m, mi) => {
      const id = `msg_${conversationId}_${mi + 1}`;
      const senderUserId = m.from === 0 ? c.a : c.b;
      s.messages.set(id, {
        id,
        conversationId,
        senderUserId,
        body: m.body,
        createdAt: isoMinutesAgo(m.mins),
        deliveredAt: isoMinutesAgo(m.mins - 1),
        readAt: isoMinutesAgo(Math.max(0, m.mins - 2)),
        deletedAt: null,
        moderationStatus: "clean",
      });
    });
  });

  // ---- Reports ----
  const reports: Report[] = [
    {
      id: "report_001",
      reporterUserId: "user_004",
      reportedUserId: "user_007",
      contentType: "message",
      reportedPhotoId: null,
      reportedMessageId: "msg_convo_002_3",
      conversationId: "convo_002",
      reason: "scam_or_spam",
      details: "Asked me to wire money and join a Telegram trading group.",
      status: "open",
      severity: "high",
      assignedAdminUserId: null,
      resolution: null,
      resolutionAdminUserId: null,
      createdAt: isoMinutesAgo(70),
      updatedAt: isoMinutesAgo(70),
      resolvedAt: null,
    },
    {
      id: "report_002",
      reporterUserId: "user_002",
      reportedUserId: "user_007",
      contentType: "profile",
      reportedPhotoId: null,
      reportedMessageId: null,
      conversationId: null,
      reason: "fake_profile",
      details: "Stock photo headshot, suspiciously generic bio.",
      status: "reviewing",
      severity: "medium",
      assignedAdminUserId: "admin_mod",
      resolution: null,
      resolutionAdminUserId: null,
      createdAt: isoDaysAgo(2),
      updatedAt: isoDaysAgo(1),
      resolvedAt: null,
    },
    {
      id: "report_003",
      reporterUserId: "user_005",
      reportedUserId: "user_007",
      contentType: "photo",
      reportedPhotoId: null,
      reportedMessageId: null,
      conversationId: null,
      reason: "sexual_content_or_nudity",
      details: "Photo 1 contains explicit content.",
      status: "open",
      severity: "high",
      assignedAdminUserId: null,
      resolution: null,
      resolutionAdminUserId: null,
      createdAt: isoDaysAgo(1),
      updatedAt: isoDaysAgo(1),
      resolvedAt: null,
    },
    {
      id: "report_004",
      reporterUserId: "user_003",
      reportedUserId: "user_006",
      contentType: "profile",
      reportedPhotoId: null,
      reportedMessageId: null,
      conversationId: null,
      reason: "offensive_profile",
      details: "Profile prompt has offensive language.",
      status: "resolved",
      severity: "low",
      assignedAdminUserId: "admin_senior",
      resolution: "no_action",
      resolutionAdminUserId: "admin_senior",
      createdAt: isoDaysAgo(10),
      updatedAt: isoDaysAgo(9),
      resolvedAt: isoDaysAgo(9),
    },
    {
      id: "report_005",
      reporterUserId: "user_001",
      reportedUserId: "user_007",
      contentType: "message",
      reportedPhotoId: null,
      reportedMessageId: null,
      conversationId: null,
      reason: "harassment",
      details: "Repeated messages after I said no.",
      status: "escalated",
      severity: "critical",
      assignedAdminUserId: "admin_ts",
      resolution: null,
      resolutionAdminUserId: null,
      createdAt: isoMinutesAgo(20),
      updatedAt: isoMinutesAgo(15),
      resolvedAt: null,
    },
  ];
  reports.forEach((r) => s.reports.set(r.id, r));

  // ---- Bans (one prior, lifted) ----
  const ban: UserBan = {
    id: "ban_001",
    userId: "user_006",
    banType: "temporary",
    status: "lifted",
    reasonCode: "offensive_profile",
    internalNote: "First-time offender, 7-day suspension issued.",
    userFacingExplanation: "Your profile contained language that violates our community guidelines.",
    bannedByAdminUserId: "admin_senior",
    bannedAt: isoDaysAgo(30),
    expiresAt: isoDaysAgo(23),
    unbannedByAdminUserId: "admin_senior",
    unbannedAt: isoDaysAgo(23),
    unbanReason: "Suspension period elapsed; user updated profile.",
  };
  s.bans.set(ban.id, ban);

  // ---- Internal notes ----
  const note: InternalNote = {
    id: "note_001",
    targetEntityType: "user",
    targetEntityId: "user_007",
    body: "Multiple unrelated reporters; pattern matches known scam playbook (Telegram wiring).",
    createdByAdminUserId: "admin_senior",
    createdAt: isoDaysAgo(1),
  };
  s.notes.set(note.id, note);

  // ---- Initial audit events ----
  const seedAudit: AuditEvent[] = [
    {
      id: "audit_seed_1",
      adminUserId: "admin_mod",
      adminRolesAtAction: ["moderator"],
      eventType: "report.viewed",
      targetEntityType: "report",
      targetEntityId: "report_002",
      accessReason: "active_report_investigation",
      reportId: "report_002",
      moderationActionId: null,
      internalNote: null,
      requestId: null,
      ipAddress: "10.0.0.5",
      userAgent: "seed",
      metadata: null,
      createdAt: isoDaysAgo(1),
    },
    {
      id: "audit_seed_2",
      adminUserId: "admin_senior",
      adminRolesAtAction: ["senior_moderator"],
      eventType: "user.suspended",
      targetEntityType: "user",
      targetEntityId: "user_006",
      accessReason: null,
      reportId: null,
      moderationActionId: null,
      internalNote: "First-time offender, 7-day suspension issued.",
      requestId: null,
      ipAddress: "10.0.0.7",
      userAgent: "seed",
      metadata: { banType: "temporary", reasonCode: "offensive_profile" },
      createdAt: isoDaysAgo(30),
    },
  ];
  seedAudit.forEach((e) => s.audit.set(e.id, e));
}
