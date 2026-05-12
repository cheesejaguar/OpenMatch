// Mirror of backend DTOs. Keep in sync with backend/src/lib/admin/serialize.ts.
// If the two drift, the runtime payload still wins and TS is just a hint.

export interface UserSummaryDTO {
  userId: string;
  displayName: string | null;
  age: number | null;
  status: "active" | "paused" | "banned" | "deleted";
  isBanned: boolean;
  profileStatus: "visible" | "hidden" | null;
  moderationStatus: "clean" | "reviewed_ok" | "under_review" | "restricted" | "removed" | null;
  verificationStatus: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  reportCount: number;
}

export interface ProfileDetailDTO {
  id: string;
  displayName: string;
  bio: string;
  gender: string;
  pronouns: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  heightCm: number | null;
  educationLevel: string | null;
  college: string | null;
  jobTitle: string | null;
  company: string | null;
  relationshipGoal: string | null;
  interests: string[];
  languages: string[];
  verificationStatus: string;
  visibilityStatus: "visible" | "hidden";
  moderationStatus: string;
  prompts: unknown;
}

export interface BanSummaryDTO {
  id: string;
  banType: "temporary" | "permanent" | "safety_hold";
  status: "active" | "expired" | "lifted";
  reasonCode: string;
  bannedAt: string;
  expiresAt: string | null;
  unbannedAt: string | null;
}

export interface UserDetailDTO extends UserSummaryDTO {
  email: string | null;
  emailMasked: string | null;
  dateOfBirth: string | null;
  profile: ProfileDetailDTO | null;
  bans: BanSummaryDTO[];
}

export interface PhotoDTO {
  id: string;
  storageKey: string;
  url: string | null;
  sortOrder: number;
  moderationStatus: string;
  createdAt: string;
}

export interface ReportSummaryDTO {
  id: string;
  reason: string;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  createdAt: string;
  resolution: string | null;
  assignedAdminUserId: string | null;
  reporter: UserSummaryDTO;
  reported: UserSummaryDTO;
}

export interface ReportDetailDTO extends ReportSummaryDTO {
  details: string | null;
  resolvedAt: string | null;
  reportedProfileId: string | null;
  reportedMessageId: string | null;
  reportedMessage: {
    id: string;
    body: string;
    senderUserId: string;
    createdAt: string;
    moderationStatus: string;
  } | null;
  messageContext: Array<{
    id: string;
    body: string;
    senderUserId: string;
    createdAt: string;
    moderationStatus: string;
  }>;
  priorReports: Array<{
    id: string;
    reason: string;
    status: string;
    createdAt: string;
    resolution: string | null;
  }>;
  notes: Array<{
    id: string;
    body: string;
    createdByAdminUserId: string;
    createdAt: string;
  }>;
  moderationActions: Array<{
    id: string;
    actionType: string;
    reasonCode: string;
    internalNote: string | null;
    userFacingExplanation: string | null;
    createdByAdminUserId: string;
    createdAt: string;
  }>;
}

export interface AuditEventDTO {
  id: string;
  adminUserId: string;
  adminRoleSnapshot: string;
  eventType: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  accessReason: string | null;
  reportId: string | null;
  moderationActionId: string | null;
  sensitiveAccessGrantId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface OverviewMetricsDTO {
  openReports: number;
  reportsByReason: Array<{ reason: string; count: number }>;
  averageOpenReportAgeHours: number | null;
  newUsers24h: number;
  bannedToday: number;
  activeSuspensions: number;
  photoModerationQueue: number;
  escalatedReports: number;
  adminActionsToday: number;
}
