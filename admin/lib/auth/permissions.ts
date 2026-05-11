// Permission catalog. Mirrors PRD §3.2.
// Permissions are checked server-side on every action and route handler (PRD §6.2).

export const PERMISSIONS = [
  "user.read.summary",
  "user.read.full_profile",
  "user.read.private_fields",
  "photo.read.report_context",
  "photo.read.all",
  "photo.action.review",
  "message.read.report_context",
  "message.read.all",
  "report.read.all",
  "report.assign",
  "report.resolve",
  "user.ban.temporary",
  "user.ban.permanent",
  "user.unban",
  "note.write",
  "audit.read",
  "admin.manage_roles",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleName =
  | "viewer"
  | "moderator"
  | "senior_moderator"
  | "trust_safety_admin"
  | "system_admin"
  | "auditor";

export const ROLES: Record<RoleName, { label: string; description: string; permissions: Permission[] }> = {
  viewer: {
    label: "Viewer",
    description: "Read-only summary access. No private content.",
    permissions: ["user.read.summary", "report.read.all"],
  },
  moderator: {
    label: "Moderator",
    description: "Triage and resolve reports with report-context access only.",
    permissions: [
      "user.read.summary",
      "user.read.full_profile",
      "photo.read.report_context",
      "photo.action.review",
      "message.read.report_context",
      "report.read.all",
      "report.assign",
      "report.resolve",
      "user.ban.temporary",
      "note.write",
    ],
  },
  senior_moderator: {
    label: "Senior Moderator",
    description: "Broader enforcement, full message access with reason capture.",
    permissions: [
      "user.read.summary",
      "user.read.full_profile",
      "user.read.private_fields",
      "photo.read.report_context",
      "photo.read.all",
      "photo.action.review",
      "message.read.report_context",
      "message.read.all",
      "report.read.all",
      "report.assign",
      "report.resolve",
      "user.ban.temporary",
      "user.ban.permanent",
      "note.write",
    ],
  },
  trust_safety_admin: {
    label: "Trust & Safety Admin",
    description: "Highest moderation privilege. Bans, unbans, audit read.",
    permissions: [
      "user.read.summary",
      "user.read.full_profile",
      "user.read.private_fields",
      "photo.read.report_context",
      "photo.read.all",
      "photo.action.review",
      "message.read.report_context",
      "message.read.all",
      "report.read.all",
      "report.assign",
      "report.resolve",
      "user.ban.temporary",
      "user.ban.permanent",
      "user.unban",
      "note.write",
      "audit.read",
    ],
  },
  system_admin: {
    label: "System Admin",
    description: "Manages admin roles and system settings. No moderation by default.",
    permissions: [
      "user.read.summary",
      "admin.manage_roles",
      "audit.read",
      "settings.manage",
    ],
  },
  auditor: {
    label: "Auditor",
    description: "Read-only access to audit logs and aggregate reports.",
    permissions: ["audit.read", "report.read.all", "user.read.summary"],
  },
};

// Sensitive permissions that require an access reason capture (PRD §3.3).
export const SENSITIVE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "user.read.private_fields",
  "photo.read.all",
  "message.read.all",
]);

export function permissionsForRoles(roles: RoleName[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const r of roles) {
    for (const p of ROLES[r].permissions) set.add(p);
  }
  return set;
}
