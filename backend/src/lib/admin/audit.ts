import type { AccessReasonCode, AdminEventType, Prisma, PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { hashForAudit } from "./hash.js";

export interface AuditContext {
  adminUserId: string;
  adminRoleSnapshot: string;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEventInput {
  eventType: AdminEventType;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  accessReason?: AccessReasonCode | null;
  reportId?: string | null;
  moderationActionId?: string | null;
  sensitiveAccessGrantId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

type AnyPrismaClient = PrismaClient | Prisma.TransactionClient;

// Single chokepoint for writes to AdminAuditLog. Every admin route handler
// MUST call this for any sensitive read or any state-changing action.
// Append-only is enforced at the application layer by never exposing
// update/delete helpers from this module.
export async function writeAudit(
  prisma: AnyPrismaClient,
  ctx: AuditContext,
  event: AuditEventInput,
): Promise<{ id: string }> {
  const row = await prisma.adminAuditLog.create({
    data: {
      adminUserId: ctx.adminUserId,
      adminRoleSnapshot: ctx.adminRoleSnapshot,
      eventType: event.eventType,
      targetEntityType: event.targetEntityType ?? null,
      targetEntityId: event.targetEntityId ?? null,
      accessReason: event.accessReason ?? null,
      reportId: event.reportId ?? null,
      moderationActionId: event.moderationActionId ?? null,
      sensitiveAccessGrantId: event.sensitiveAccessGrantId ?? null,
      requestId: ctx.requestId ?? null,
      ipHash: ctx.ipHash ?? null,
      userAgent: ctx.userAgent ?? null,
      metadata: event.metadata ?? undefined,
    },
    select: { id: true },
  });
  return row;
}

export function auditContextFromRequest(
  req: FastifyRequest,
  adminUserId: string,
  roles: string[],
): AuditContext {
  const ip = req.ip;
  return {
    adminUserId,
    adminRoleSnapshot: roles.join(","),
    ipHash: ip ? hashForAudit(ip) : null,
    userAgent: req.headers["user-agent"] ?? null,
    requestId: req.id ?? null,
  };
}

// Run write + audit insert in the same Prisma transaction so they cannot
// diverge. Callers receive the transaction client and the audit row id is
// stitched onto the resulting moderation action via moderationActionId.
export async function withAuditedTransaction<T>(
  prisma: PrismaClient,
  ctx: AuditContext,
  event: AuditEventInput,
  fn: (tx: Prisma.TransactionClient) => Promise<{ result: T; moderationActionId?: string }>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const { result, moderationActionId } = await fn(tx);
    await writeAudit(tx, ctx, {
      ...event,
      moderationActionId: moderationActionId ?? event.moderationActionId ?? null,
    });
    return result;
  });
}
