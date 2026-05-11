// In-memory mock data store for the Phase 0 prototype admin dashboard
// (PRD §20.1). A real deployment replaces this with the Admin API and
// Postgres-backed Prisma models defined in PRD §17 and mirrored in
// backend/prisma/schema.prisma + backend/prisma/admin.prisma.
//
// NOTE: process-local state on Vercel serverless functions is per-instance and
// does not persist across cold starts. This is acceptable for previewing UI
// flows; never use the in-memory store with real user data.

import type {
  AdminUserRecord,
  AuditEvent,
  Conversation,
  InternalNote,
  Message,
  ModerationAction,
  Report,
  SensitiveAccessGrant,
  UserBan,
  UserRecord,
} from "./types";
import { seed } from "./seed";

type Store = {
  adminUsers: Map<string, AdminUserRecord>;
  users: Map<string, UserRecord>;
  conversations: Map<string, Conversation>;
  messages: Map<string, Message>;
  reports: Map<string, Report>;
  bans: Map<string, UserBan>;
  notes: Map<string, InternalNote>;
  actions: Map<string, ModerationAction>;
  audit: Map<string, AuditEvent>;
  grants: Map<string, SensitiveAccessGrant>;
};

declare global {
  // eslint-disable-next-line no-var
  var __omAdminStore: Store | undefined;
}

function makeStore(): Store {
  const s: Store = {
    adminUsers: new Map(),
    users: new Map(),
    conversations: new Map(),
    messages: new Map(),
    reports: new Map(),
    bans: new Map(),
    notes: new Map(),
    actions: new Map(),
    audit: new Map(),
    grants: new Map(),
  };
  seed(s);
  return s;
}

export function getStore(): Store {
  if (!globalThis.__omAdminStore) {
    globalThis.__omAdminStore = makeStore();
  }
  return globalThis.__omAdminStore;
}

// ---- Admin users ----

export function getAdminUserById(id: string): AdminUserRecord | undefined {
  return getStore().adminUsers.get(id);
}
export function listAdminUsers(): AdminUserRecord[] {
  return [...getStore().adminUsers.values()];
}
export function updateAdminUser(id: string, patch: Partial<AdminUserRecord>): void {
  const a = getStore().adminUsers.get(id);
  if (!a) throw new Error("admin not found");
  getStore().adminUsers.set(id, { ...a, ...patch });
}

// ---- Users ----

export type UserSearchFilters = {
  query?: string;
  status?: UserRecord["status"];
  verification?: UserRecord["verificationStatus"];
};

export function listUsers(filters: UserSearchFilters = {}): UserRecord[] {
  const all = [...getStore().users.values()];
  const q = filters.query?.toLowerCase().trim() ?? "";
  return all
    .filter((u) => {
      if (filters.status && u.status !== filters.status) return false;
      if (filters.verification && u.verificationStatus !== filters.verification) return false;
      if (!q) return true;
      return (
        u.id.toLowerCase().includes(q) ||
        u.profileId.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.emailHashedDisplay.toLowerCase().includes(q) ||
        (u.city ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export function getUserById(id: string): UserRecord | undefined {
  return getStore().users.get(id);
}

export function updateUser(id: string, patch: Partial<UserRecord>): void {
  const u = getStore().users.get(id);
  if (!u) throw new Error("user not found");
  getStore().users.set(id, { ...u, ...patch });
}

// ---- Conversations & messages ----

export function listConversations(filter?: { userId?: string }): Conversation[] {
  const all = [...getStore().conversations.values()];
  if (filter?.userId) {
    return all.filter((c) => c.participantUserIds.includes(filter.userId!));
  }
  return all;
}
export function getConversationById(id: string): Conversation | undefined {
  return getStore().conversations.get(id);
}
export function listMessagesForConversation(conversationId: string): Message[] {
  return [...getStore().messages.values()]
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function getMessageById(id: string): Message | undefined {
  return getStore().messages.get(id);
}

// ---- Reports ----

export type ReportFilters = {
  status?: Report["status"];
  reason?: Report["reason"];
  assignedTo?: string;
  contentType?: Report["contentType"];
};

export function listReports(filters: ReportFilters = {}): Report[] {
  return [...getStore().reports.values()]
    .filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.reason && r.reason !== filters.reason) return false;
      if (filters.assignedTo && r.assignedAdminUserId !== filters.assignedTo) return false;
      if (filters.contentType && r.contentType !== filters.contentType) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getReportById(id: string): Report | undefined {
  return getStore().reports.get(id);
}
export function updateReport(id: string, patch: Partial<Report>): void {
  const r = getStore().reports.get(id);
  if (!r) throw new Error("report not found");
  getStore().reports.set(id, { ...r, ...patch, updatedAt: new Date().toISOString() });
}
export function listReportsByUserId(userId: string): Report[] {
  return [...getStore().reports.values()].filter(
    (r) => r.reportedUserId === userId || r.reporterUserId === userId,
  );
}

// ---- Bans ----

export function listBansForUser(userId: string): UserBan[] {
  return [...getStore().bans.values()]
    .filter((b) => b.userId === userId)
    .sort((a, b) => b.bannedAt.localeCompare(a.bannedAt));
}
export function activeBanForUser(userId: string): UserBan | undefined {
  return [...getStore().bans.values()].find(
    (b) => b.userId === userId && b.status === "active",
  );
}
export function insertBan(ban: UserBan): void {
  getStore().bans.set(ban.id, ban);
}
export function updateBan(id: string, patch: Partial<UserBan>): void {
  const b = getStore().bans.get(id);
  if (!b) throw new Error("ban not found");
  getStore().bans.set(id, { ...b, ...patch });
}

// ---- Notes ----

export function listNotes(targetEntityType: InternalNote["targetEntityType"], targetEntityId: string): InternalNote[] {
  return [...getStore().notes.values()]
    .filter((n) => n.targetEntityType === targetEntityType && n.targetEntityId === targetEntityId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function insertNote(note: InternalNote): void {
  getStore().notes.set(note.id, note);
}

// ---- Moderation actions ----

export function listModerationActionsForUser(userId: string): ModerationAction[] {
  return [...getStore().actions.values()]
    .filter((a) => a.targetUserId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function insertModerationAction(action: ModerationAction): void {
  getStore().actions.set(action.id, action);
}

// ---- Audit log ----

export type AuditFilters = {
  adminUserId?: string;
  targetEntityId?: string;
  eventType?: AuditEvent["eventType"];
  fromDate?: string;
  toDate?: string;
};
export function listAuditEvents(filters: AuditFilters = {}, limit = 200): AuditEvent[] {
  return [...getStore().audit.values()]
    .filter((e) => {
      if (filters.adminUserId && e.adminUserId !== filters.adminUserId) return false;
      if (filters.targetEntityId && e.targetEntityId !== filters.targetEntityId) return false;
      if (filters.eventType && e.eventType !== filters.eventType) return false;
      if (filters.fromDate && e.createdAt < filters.fromDate) return false;
      if (filters.toDate && e.createdAt > filters.toDate) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
export function insertAuditEvent(event: AuditEvent): void {
  getStore().audit.set(event.id, event);
}

// ---- Sensitive access grants ----

export function insertGrant(grant: SensitiveAccessGrant): void {
  getStore().grants.set(grant.id, grant);
}
export function getGrant(id: string): SensitiveAccessGrant | undefined {
  return getStore().grants.get(id);
}
export function findActiveGrant(
  adminUserId: string,
  targetEntityType: SensitiveAccessGrant["targetEntityType"],
  targetEntityId: string,
): SensitiveAccessGrant | undefined {
  const now = new Date().toISOString();
  return [...getStore().grants.values()].find(
    (g) =>
      g.adminUserId === adminUserId &&
      g.targetEntityType === targetEntityType &&
      g.targetEntityId === targetEntityId &&
      g.expiresAt > now,
  );
}

// ---- Aggregate metrics ----

export function overviewMetrics() {
  const reports = [...getStore().reports.values()];
  const users = [...getStore().users.values()];
  const bans = [...getStore().bans.values()];
  const audit = [...getStore().audit.values()];
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const open = reports.filter((r) => r.status === "open" || r.status === "reviewing");
  return {
    openReports: open.length,
    escalatedReports: reports.filter((r) => r.status === "escalated").length,
    reportsBySeverity: {
      low: open.filter((r) => r.severity === "low").length,
      medium: open.filter((r) => r.severity === "medium").length,
      high: open.filter((r) => r.severity === "high").length,
      critical: open.filter((r) => r.severity === "critical").length,
    },
    reportsByCategory: open.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    }, {}),
    averageReportAgeHours: open.length
      ? Math.round(
          open.reduce(
            (acc, r) => acc + (Date.now() - new Date(r.createdAt).getTime()) / 36e5,
            0,
          ) / open.length,
        )
      : 0,
    newUsers24h: users.filter((u) => u.createdAt >= since24h).length,
    bannedUsers24h: bans.filter((b) => b.bannedAt >= since24h).length,
    suspendedUsers: users.filter((u) => u.status === "suspended").length,
    photoQueue: users.flatMap((u) => u.photos).filter((p) => p.moderationStatus === "under_review")
      .length,
    messageReports: reports.filter((r) => r.contentType === "message").length,
    actionsToday: audit.filter(
      (a) =>
        a.createdAt >= since24h &&
        ["report.resolved", "user.banned", "user.unbanned", "photo.action"].includes(
          a.eventType,
        ),
    ).length,
  };
}
