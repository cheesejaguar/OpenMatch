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
  // SEV-M12 — Reporter identity is gated behind a *stricter* permission
  // than the rest of the report DTO. Any admin with `report.read.all`
  // sees the reported-user content (so they can triage), but the
  // reporter is redacted by default to a pseudonymous handle so a
  // malicious / coerced triager can't leak who-reported-whom. Granted
  // to senior_moderator + trust_safety_admin only.
  REPORT_READ_REPORTER_IDENTITY: "report.read.reporter_identity",
  // SEV-M12 — Permission for the explicit "reveal reporter" admin
  // action when a triager who only has `report.read.all` needs to
  // unmask a reporter for a specific investigation. Each reveal
  // writes an `AdminAuditLog` row with eventType =
  // `sensitive_access_granted` and a `SensitiveAccessGrant` record.
  REPORT_REVEAL_REPORTER: "report.reveal_reporter",
  REPORT_ASSIGN: "report.assign",
  REPORT_RESOLVE: "report.resolve",
  REPORT_ESCALATE: "report.escalate",

  AUDIT_READ: "audit.read",
  ADMIN_MANAGE_ROLES: "admin.manage_roles",
  METRICS_READ: "metrics.read",

  APPEAL_READ: "appeal.read",
  APPEAL_DECIDE: "appeal.decide",

  COMPLIANCE_EXPORT: "compliance.export",

  BETA_INVITE_MANAGE: "beta.invite.manage",
  FEATURE_FLAG_MANAGE: "feature_flag.manage",
  METRO_MANAGE: "metro.manage",
  FEEDBACK_READ: "feedback.read",
  FEEDBACK_RESOLVE: "feedback.resolve",
  // Status page operations: posting / editing incident updates that
  // appear on the public /status page. Granted to ops + senior admin
  // roles. Read access to the public status data is unauthenticated
  // (the page anyone can hit) so there is no matching READ permission.
  INCIDENT_MANAGE: "incident.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);
