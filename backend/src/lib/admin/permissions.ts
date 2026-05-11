// Permission catalog. Each string is a stable identifier referenced from
// route handlers via requirePermission(). Keep this file as the single
// source of truth; admin UI imports the mirror in admin/lib/rbac.

export const PERMISSIONS = {
  USER_READ_SUMMARY: "user.read.summary",
  USER_READ_FULL_PROFILE: "user.read.full_profile",
  USER_READ_PRIVATE_FIELDS: "user.read.private_fields",
  USER_BAN_TEMPORARY: "user.ban.temporary",
  USER_BAN_PERMANENT: "user.ban.permanent",
  USER_UNBAN: "user.unban",
  USER_NOTE_WRITE: "user.note.write",

  PHOTO_READ_ALL: "photo.read.all",
  PHOTO_READ_REPORT_CONTEXT: "photo.read.report_context",
  PHOTO_MODERATE: "photo.moderate",

  MESSAGE_READ_ALL: "message.read.all",
  MESSAGE_READ_REPORT_CONTEXT: "message.read.report_context",

  REPORT_READ_ALL: "report.read.all",
  REPORT_ASSIGN: "report.assign",
  REPORT_RESOLVE: "report.resolve",
  REPORT_ESCALATE: "report.escalate",

  AUDIT_READ: "audit.read",
  ADMIN_MANAGE_ROLES: "admin.manage_roles",
  METRICS_READ: "metrics.read",

  APPEAL_READ: "appeal.read",
  APPEAL_DECIDE: "appeal.decide",

  COMPLIANCE_EXPORT: "compliance.export",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);
