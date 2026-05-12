import { PERMISSIONS, type Permission } from "./permissions.js";

// PRD §3.1: six built-in roles. Permissions follow §3.2.
// Names are stable string keys (lowercase snake_case) and match the values
// stored in AdminRole.name.

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: Permission[];
}

const P = PERMISSIONS;

export const ADMIN_ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    name: "viewer",
    description: "Lowest-privilege. Aggregate metrics and limited user summaries only.",
    permissions: [P.USER_READ_SUMMARY, P.REPORT_READ_ALL, P.METRICS_READ],
  },
  {
    name: "moderator",
    description: "Primary trust-and-safety operator. Resolves reports, warns or suspends.",
    permissions: [
      P.USER_READ_SUMMARY,
      P.USER_READ_FULL_PROFILE,
      P.PHOTO_READ_REPORT_CONTEXT,
      P.MESSAGE_READ_REPORT_CONTEXT,
      P.REPORT_READ_ALL,
      P.REPORT_ASSIGN,
      P.REPORT_RESOLVE,
      P.REPORT_ESCALATE,
      P.USER_BAN_TEMPORARY,
      P.USER_NOTE_WRITE,
      P.PHOTO_MODERATE,
      P.METRICS_READ,
    ],
  },
  {
    name: "senior_moderator",
    description:
      "Experienced moderator. Full message access with reason capture; can ban permanently.",
    permissions: [
      P.USER_READ_SUMMARY,
      P.USER_READ_FULL_PROFILE,
      P.PHOTO_READ_REPORT_CONTEXT,
      P.PHOTO_READ_ALL,
      P.MESSAGE_READ_REPORT_CONTEXT,
      P.MESSAGE_READ_ALL,
      P.REPORT_READ_ALL,
      P.REPORT_ASSIGN,
      P.REPORT_RESOLVE,
      P.REPORT_ESCALATE,
      P.USER_BAN_TEMPORARY,
      P.USER_BAN_PERMANENT,
      P.USER_NOTE_WRITE,
      P.PHOTO_MODERATE,
      P.METRICS_READ,
    ],
  },
  {
    name: "trust_safety_admin",
    description: "Policy enforcement and escalations. Can ban, unban, manage appeals, view audit.",
    permissions: [
      P.USER_READ_SUMMARY,
      P.USER_READ_FULL_PROFILE,
      P.USER_READ_PRIVATE_FIELDS,
      P.PHOTO_READ_ALL,
      P.PHOTO_READ_REPORT_CONTEXT,
      P.PHOTO_MODERATE,
      P.MESSAGE_READ_ALL,
      P.MESSAGE_READ_REPORT_CONTEXT,
      P.REPORT_READ_ALL,
      P.REPORT_ASSIGN,
      P.REPORT_RESOLVE,
      P.REPORT_ESCALATE,
      P.USER_BAN_TEMPORARY,
      P.USER_BAN_PERMANENT,
      P.USER_UNBAN,
      P.USER_NOTE_WRITE,
      P.APPEAL_READ,
      P.APPEAL_DECIDE,
      P.AUDIT_READ,
      P.METRICS_READ,
    ],
  },
  {
    name: "system_admin",
    description: "Technical administrator. Manages admin roles and operational config.",
    permissions: [P.USER_READ_SUMMARY, P.ADMIN_MANAGE_ROLES, P.AUDIT_READ, P.METRICS_READ],
  },
  {
    name: "auditor",
    description: "Read-only auditor. Reviews admin actions and audit log.",
    permissions: [P.AUDIT_READ, P.METRICS_READ],
  },
];

export const ROLE_NAMES = ADMIN_ROLE_DEFINITIONS.map((r) => r.name);
