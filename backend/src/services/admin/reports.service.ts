import type {
  ModerationDecision,
  Prisma,
  PrismaClient,
  ReasonCode,
  ReportStatus,
} from "@prisma/client";
import { type PermissionSet, serializeUserSummary } from "../../lib/admin/serialize.js";

export interface ReportedMessageDTO {
  id: string;
  body: string;
  senderUserId: string;
  createdAt: string;
  moderationStatus: string;
}

export interface ListReportsArgs {
  status?: ReportStatus;
  reason?: string;
  assignedAdminUserId?: string;
  limit: number;
  cursor?: string;
}

export async function listReports(
  prisma: PrismaClient,
  args: ListReportsArgs,
  perms: PermissionSet,
) {
  const where: Prisma.ReportWhereInput = {};
  if (args.status) where.status = args.status;
  if (args.reason) where.reason = args.reason;
  if (args.assignedAdminUserId) where.assignedAdminUserId = args.assignedAdminUserId;
  const take = Math.min(args.limit, 100) + 1;
  const rows = await prisma.report.findMany({
    where,
    include: {
      reporter: { include: { profile: true, _count: { select: { reportsAbout: true } } } },
      reported: { include: { profile: true, _count: { select: { reportsAbout: true } } } },
    },
    take,
    ...(args.cursor ? { skip: 1, cursor: { id: args.cursor } } : {}),
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const next = rows.length > take - 1 ? rows[take - 1]!.id : null;
  const page = rows.slice(0, take - 1);
  return {
    reports: page.map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolution: r.resolution,
      assignedAdminUserId: r.assignedAdminUserId,
      reporter: serializeUserSummary(r.reporter, perms),
      reported: serializeUserSummary(r.reported, perms),
    })),
    nextCursor: next,
  };
}

export async function getReportDetail(
  prisma: PrismaClient,
  reportId: string,
  perms: PermissionSet,
) {
  const r = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      reporter: { include: { profile: true, _count: { select: { reportsAbout: true } } } },
      reported: {
        include: {
          profile: { include: { photos: { orderBy: { sortOrder: "asc" } } } },
          bans: { orderBy: { bannedAt: "desc" }, take: 10 },
          _count: { select: { reportsAbout: true } },
        },
      },
      moderationActions: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!r) return null;
  const priorReports = await prisma.report.findMany({
    where: { reportedUserId: r.reportedUserId, NOT: { id: r.id } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      reason: true,
      status: true,
      createdAt: true,
      resolution: true,
    },
  });
  // Reported message body + ±20 surrounding for context. Permission-gated
  // at the route layer (message.read.report_context).
  let reportedMessage: ReportedMessageDTO | null = null;
  let context: ReportedMessageDTO[] = [];
  if (r.reportedMessageId) {
    const msg = await prisma.message.findUnique({
      where: { id: r.reportedMessageId },
    });
    if (msg) {
      const before = await prisma.message.findMany({
        where: {
          conversationId: msg.conversationId,
          createdAt: { lt: msg.createdAt },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const after = await prisma.message.findMany({
        where: {
          conversationId: msg.conversationId,
          createdAt: { gt: msg.createdAt },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      const mapMsg = (m: typeof msg): ReportedMessageDTO => ({
        id: m.id,
        body: m.body,
        senderUserId: m.senderUserId,
        createdAt: m.createdAt.toISOString(),
        moderationStatus: m.moderationStatus,
      });
      reportedMessage = mapMsg(msg);
      context = [...before.reverse().map(mapMsg), mapMsg(msg), ...after.map(mapMsg)];
    }
  }
  return {
    id: r.id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    resolution: r.resolution,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    assignedAdminUserId: r.assignedAdminUserId,
    reporter: serializeUserSummary(r.reporter, perms),
    reported: serializeUserSummary(r.reported, perms),
    reportedProfileId: r.reportedProfileId,
    reportedMessageId: r.reportedMessageId,
    reportedMessage,
    messageContext: context,
    priorReports: priorReports.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
    })),
    notes: r.notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdByAdminUserId: n.createdByAdminUserId,
      createdAt: n.createdAt.toISOString(),
    })),
    moderationActions: r.moderationActions.map((m) => ({
      id: m.id,
      actionType: m.actionType,
      reasonCode: m.reasonCode,
      internalNote: m.internalNote,
      userFacingExplanation: m.userFacingExplanation,
      createdByAdminUserId: m.createdByAdminUserId,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export interface ResolveReportArgs {
  reportId: string;
  resolution: ModerationDecision;
  reasonCode: ReasonCode;
  internalNote?: string | null;
  userFacingExplanation?: string | null;
  adminUserId: string;
}

export async function resolveReport(
  prisma: PrismaClient,
  args: ResolveReportArgs,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const report = await db.report.findUnique({ where: { id: args.reportId } });
  if (!report) throw Object.assign(new Error("report_not_found"), { statusCode: 404 });

  const action = await db.moderationAction.create({
    data: {
      reportId: report.id,
      targetUserId: report.reportedUserId,
      targetProfileId: report.reportedProfileId,
      targetMessageId: report.reportedMessageId,
      actionType: args.resolution,
      reasonCode: args.reasonCode,
      internalNote: args.internalNote ?? null,
      userFacingExplanation: args.userFacingExplanation ?? null,
      createdByAdminUserId: args.adminUserId,
    },
  });
  const updated = await db.report.update({
    where: { id: report.id },
    data: {
      status: "resolved",
      resolution: args.resolution,
      resolvedAt: new Date(),
      moderatorId: args.adminUserId,
    },
  });
  return { report: updated, moderationAction: action };
}
