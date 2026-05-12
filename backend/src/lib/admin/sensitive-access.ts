import type { AccessReasonCode, PrismaClient, SensitiveEntityType } from "@prisma/client";
import { env } from "../../env.js";

// Sensitive access grants record that an admin explicitly justified
// access to non-report-context data (e.g. arbitrary conversations or
// photo galleries). PRD §3.3, §15.4.

export interface RequireGrantArgs {
  prisma: PrismaClient;
  adminUserId: string;
  entityType: SensitiveEntityType;
  entityId: string;
  grantId?: string | null;
}

export class AccessReasonRequiredError extends Error {
  statusCode = 412;
  code = "access_reason_required";
  entityType: SensitiveEntityType;
  entityId: string;
  constructor(entityType: SensitiveEntityType, entityId: string) {
    super("access reason required");
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

export async function requireAccessGrant(
  args: RequireGrantArgs,
): Promise<{ id: string; reason: AccessReasonCode; reportId: string | null }> {
  if (!args.grantId) {
    throw new AccessReasonRequiredError(args.entityType, args.entityId);
  }
  const grant = await args.prisma.sensitiveAccessGrant.findUnique({
    where: { id: args.grantId },
  });
  if (!grant) throw new AccessReasonRequiredError(args.entityType, args.entityId);
  if (grant.adminUserId !== args.adminUserId) {
    throw new AccessReasonRequiredError(args.entityType, args.entityId);
  }
  if (grant.targetEntityType !== args.entityType || grant.targetEntityId !== args.entityId) {
    throw new AccessReasonRequiredError(args.entityType, args.entityId);
  }
  if (grant.expiresAt.getTime() < Date.now()) {
    throw new AccessReasonRequiredError(args.entityType, args.entityId);
  }
  return { id: grant.id, reason: grant.reason, reportId: grant.reportId };
}

export interface CreateGrantArgs {
  prisma: PrismaClient;
  adminUserId: string;
  entityType: SensitiveEntityType;
  entityId: string;
  reason: AccessReasonCode;
  note?: string | null;
  reportId?: string | null;
}

export async function createAccessGrant(args: CreateGrantArgs) {
  const expiresAt = new Date(Date.now() + env.ADMIN_ACCESS_GRANT_TTL_SECONDS * 1000);
  return args.prisma.sensitiveAccessGrant.create({
    data: {
      adminUserId: args.adminUserId,
      targetEntityType: args.entityType,
      targetEntityId: args.entityId,
      reason: args.reason,
      note: args.note ?? null,
      reportId: args.reportId ?? null,
      expiresAt,
    },
  });
}
