// Domain types for the admin dashboard. The shapes mirror the consumer-app
// Prisma schema (backend/prisma/schema.prisma) and the admin-only entities
// defined in the PRD §17.

import type { RoleName } from "@/lib/auth/permissions";

export type AccountStatus = "active" | "paused" | "banned" | "suspended" | "deleted";
export type VisibilityStatus = "visible" | "hidden";
export type ModerationStatus =
  | "clean"
  | "reviewed_ok"
  | "under_review"
  | "restricted"
  | "removed";
export type VerificationStatus = "unverified" | "pending" | "verified";

export type ReasonCode =
  | "harassment"
  | "hate_or_discrimination"
  | "threats_or_violence"
  | "sexual_content_or_nudity"
  | "scam_or_spam"
  | "fake_profile"
  | "underage_user"
  | "impersonation"
  | "offensive_profile"
  | "off_platform_solicitation"
  | "ban_evasion"
  | "other";

export const REASON_CODES: { value: ReasonCode; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "hate_or_discrimination", label: "Hate or discrimination" },
  { value: "threats_or_violence", label: "Threats or violence" },
  { value: "sexual_content_or_nudity", label: "Sexual content or nudity" },
  { value: "scam_or_spam", label: "Scam or spam" },
  { value: "fake_profile", label: "Fake profile" },
  { value: "underage_user", label: "Underage user" },
  { value: "impersonation", label: "Impersonation" },
  { value: "offensive_profile", label: "Offensive profile" },
  { value: "off_platform_solicitation", label: "Off-platform solicitation" },
  { value: "ban_evasion", label: "Ban evasion" },
  { value: "other", label: "Other" },
];

export type AccessReason =
  | "active_report_investigation"
  | "user_appeal"
  | "scam_spam_investigation"
  | "impersonation_investigation"
  | "safety_escalation"
  | "legal_compliance_request"
  | "quality_review"
  | "other";

export const ACCESS_REASONS: { value: AccessReason; label: string }[] = [
  { value: "active_report_investigation", label: "Active report investigation" },
  { value: "user_appeal", label: "User appeal" },
  { value: "scam_spam_investigation", label: "Scam / spam investigation" },
  { value: "impersonation_investigation", label: "Impersonation investigation" },
  { value: "safety_escalation", label: "Safety escalation" },
  { value: "legal_compliance_request", label: "Legal / compliance request" },
  { value: "quality_review", label: "Quality review" },
  { value: "other", label: "Other (note required)" },
];

export type AdminUserRecord = {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "disabled";
  roles: RoleName[];
  createdAt: string;
  lastLoginAt: string | null;
};

export type Photo = {
  id: string;
  storageKey: string;
  cdnUrl: string;
  sortOrder: number;
  moderationStatus: ModerationStatus;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type UserRecord = {
  id: string;
  profileId: string;
  status: AccountStatus;
  createdAt: string;
  lastActiveAt: string;
  emailHashedDisplay: string;
  phoneHashedDisplay: string | null;
  dateOfBirth: string;
  age: number;
  displayName: string;
  gender: string;
  pronouns: string | null;
  bio: string;
  city: string | null;
  region: string | null;
  country: string | null;
  heightCm: number | null;
  college: string | null;
  educationLevel: string | null;
  jobTitle: string | null;
  company: string | null;
  relationshipGoal: string | null;
  drinking: string | null;
  smoking: string | null;
  exercise: string | null;
  diet: string | null;
  religion: string | null;
  interests: string[];
  prompts: { question: string; answer: string }[];
  verificationStatus: VerificationStatus;
  visibilityStatus: VisibilityStatus;
  moderationStatus: ModerationStatus;
  photos: Photo[];
  preferences: {
    minAge: number;
    maxAge: number;
    maxDistanceKm: number;
    interestedGenders: string[];
    relationshipGoals: string[];
  };
};

export type UserBan = {
  id: string;
  userId: string;
  banType: "temporary" | "permanent" | "safety_hold";
  status: "active" | "lifted";
  reasonCode: ReasonCode;
  internalNote: string;
  userFacingExplanation: string | null;
  bannedByAdminUserId: string;
  bannedAt: string;
  expiresAt: string | null;
  unbannedByAdminUserId: string | null;
  unbannedAt: string | null;
  unbanReason: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  deletedAt: string | null;
  moderationStatus: ModerationStatus;
};

export type Conversation = {
  id: string;
  matchId: string;
  participantUserIds: [string, string];
  createdAt: string;
  status: "active" | "closed";
};

export type ReportContentType = "profile" | "photo" | "message";

export type Report = {
  id: string;
  reporterUserId: string;
  reportedUserId: string;
  contentType: ReportContentType;
  reportedPhotoId: string | null;
  reportedMessageId: string | null;
  conversationId: string | null;
  reason: ReasonCode;
  details: string | null;
  status: "open" | "reviewing" | "resolved" | "dismissed" | "escalated";
  severity: "low" | "medium" | "high" | "critical";
  assignedAdminUserId: string | null;
  resolution: ModerationDecision | null;
  resolutionAdminUserId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type ModerationDecision =
  | "no_action"
  | "warning"
  | "content_removed"
  | "temporary_suspension"
  | "permanent_ban"
  | "escalated"
  | "dismissed";

export type ModerationAction = {
  id: string;
  targetUserId: string | null;
  targetPhotoId: string | null;
  targetMessageId: string | null;
  reportId: string | null;
  actionType: ModerationDecision | "warning" | "photo_removed" | "note_added";
  reasonCode: ReasonCode | null;
  internalNote: string;
  userFacingExplanation: string | null;
  createdByAdminUserId: string;
  createdAt: string;
};

export type InternalNote = {
  id: string;
  targetEntityType: "user" | "report" | "conversation";
  targetEntityId: string;
  body: string;
  createdByAdminUserId: string;
  createdAt: string;
};

export type AuditEventType =
  | "auth.login"
  | "auth.logout"
  | "auth.failed"
  | "user.viewed"
  | "user.searched"
  | "profile.viewed"
  | "photo.viewed"
  | "photo.action"
  | "message.viewed"
  | "conversation.viewed"
  | "report.opened"
  | "report.viewed"
  | "report.assigned"
  | "report.resolved"
  | "report.escalated"
  | "user.banned"
  | "user.unbanned"
  | "user.suspended"
  | "user.restored"
  | "note.added"
  | "admin.role_changed"
  | "access_reason.granted";

export type AuditEvent = {
  id: string;
  adminUserId: string;
  adminRolesAtAction: RoleName[];
  eventType: AuditEventType;
  targetEntityType: string | null;
  targetEntityId: string | null;
  accessReason: AccessReason | null;
  reportId: string | null;
  moderationActionId: string | null;
  internalNote: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type SensitiveAccessGrant = {
  id: string;
  adminUserId: string;
  targetEntityType: "conversation" | "user_photos" | "user_full";
  targetEntityId: string;
  reason: AccessReason;
  note: string | null;
  reportId: string | null;
  createdAt: string;
  expiresAt: string;
};
