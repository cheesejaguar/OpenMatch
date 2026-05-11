// Append-only audit log writes. Every sensitive read or moderation write must
// flow through writeAudit (PRD §6.9, §10.3).

import type { AdminSession } from "@/lib/auth/session";
import { clientMetadata } from "@/lib/auth/session";
import { insertAuditEvent } from "@/lib/data/store";
import type { AccessReason, AuditEvent, AuditEventType } from "@/lib/data/types";
import { newId } from "@/lib/data/ids";

export type AuditInput = {
  session: AdminSession;
  eventType: AuditEventType;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  accessReason?: AccessReason | null;
  reportId?: string | null;
  moderationActionId?: string | null;
  internalNote?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function writeAudit(input: AuditInput): Promise<AuditEvent> {
  const { ip, userAgent } = await clientMetadata();
  const event: AuditEvent = {
    id: newId("audit"),
    adminUserId: input.session.adminUserId,
    adminRolesAtAction: input.session.roles,
    eventType: input.eventType,
    targetEntityType: input.targetEntityType ?? null,
    targetEntityId: input.targetEntityId ?? null,
    accessReason: input.accessReason ?? null,
    reportId: input.reportId ?? null,
    moderationActionId: input.moderationActionId ?? null,
    internalNote: input.internalNote ?? null,
    requestId: null,
    ipAddress: ip,
    userAgent,
    metadata: input.metadata ?? null,
    createdAt: new Date().toISOString(),
  };
  insertAuditEvent(event);
  return event;
}
