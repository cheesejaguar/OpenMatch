"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { newId } from "@/lib/data/ids";
import {
  getReportById,
  insertModerationAction,
  updateReport,
} from "@/lib/data/store";
import type { ModerationDecision, ReasonCode } from "@/lib/data/types";

const assignSchema = z.object({
  reportId: z.string().min(1),
  adminUserId: z.string().min(1),
});

export async function assignReportAction(formData: FormData) {
  const parsed = assignSchema.safeParse({
    reportId: formData.get("reportId"),
    adminUserId: formData.get("adminUserId"),
  });
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  const session = await requirePermission("report.assign");
  const r = getReportById(parsed.data.reportId);
  if (!r) return { ok: false as const, error: "Report not found" };

  updateReport(r.id, {
    assignedAdminUserId: parsed.data.adminUserId,
    status: r.status === "open" ? "reviewing" : r.status,
  });
  await writeAudit({
    session,
    eventType: "report.assigned",
    targetEntityType: "report",
    targetEntityId: r.id,
    reportId: r.id,
    metadata: { assignee: parsed.data.adminUserId },
  });
  revalidatePath(`/reports/${r.id}`);
  revalidatePath("/reports");
  return { ok: true as const };
}

const resolveSchema = z.object({
  reportId: z.string().min(1),
  decision: z.enum([
    "no_action",
    "warning",
    "content_removed",
    "temporary_suspension",
    "permanent_ban",
    "escalated",
    "dismissed",
  ]),
  reasonCode: z
    .enum([
      "harassment",
      "hate_or_discrimination",
      "threats_or_violence",
      "sexual_content_or_nudity",
      "scam_or_spam",
      "fake_profile",
      "underage_user",
      "impersonation",
      "offensive_profile",
      "off_platform_solicitation",
      "ban_evasion",
      "other",
    ])
    .optional()
    .nullable(),
  internalNote: z.string().min(3).max(2000),
  userFacingExplanation: z.string().max(2000).optional().nullable(),
});

export async function resolveReportAction(formData: FormData) {
  const parsed = resolveSchema.safeParse({
    reportId: formData.get("reportId"),
    decision: formData.get("decision"),
    reasonCode: (formData.get("reasonCode") as string | null) || null,
    internalNote: formData.get("internalNote"),
    userFacingExplanation: formData.get("userFacingExplanation") || null,
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const session = await requirePermission("report.resolve");
  const data = parsed.data;
  const report = getReportById(data.reportId);
  if (!report) return { ok: false as const, error: "Report not found" };

  const action = {
    id: newId("modact"),
    targetUserId: report.reportedUserId,
    targetPhotoId: report.reportedPhotoId,
    targetMessageId: report.reportedMessageId,
    reportId: report.id,
    actionType: data.decision as ModerationDecision,
    reasonCode: (data.reasonCode as ReasonCode | null) ?? null,
    internalNote: data.internalNote,
    userFacingExplanation: data.userFacingExplanation ?? null,
    createdByAdminUserId: session.adminUserId,
    createdAt: new Date().toISOString(),
  };
  insertModerationAction(action);

  let newStatus: typeof report.status = "resolved";
  if (data.decision === "escalated") newStatus = "escalated";
  if (data.decision === "dismissed") newStatus = "dismissed";

  updateReport(report.id, {
    status: newStatus,
    resolution: data.decision as ModerationDecision,
    resolutionAdminUserId: session.adminUserId,
    resolvedAt: newStatus === "resolved" ? new Date().toISOString() : null,
  });

  await writeAudit({
    session,
    eventType: data.decision === "escalated" ? "report.escalated" : "report.resolved",
    targetEntityType: "report",
    targetEntityId: report.id,
    reportId: report.id,
    moderationActionId: action.id,
    internalNote: data.internalNote,
    metadata: { decision: data.decision, reasonCode: data.reasonCode },
  });

  revalidatePath(`/reports/${report.id}`);
  revalidatePath("/reports");
  return { ok: true as const };
}
