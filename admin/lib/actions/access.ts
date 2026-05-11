"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { newId } from "@/lib/data/ids";
import { findActiveGrant, insertGrant } from "@/lib/data/store";
import type { AccessReason, SensitiveAccessGrant } from "@/lib/data/types";

// Sensitive access grant lifetime (PRD §16.4 example response).
const GRANT_TTL_MINUTES = 30;

const grantSchema = z.object({
  targetEntityType: z.enum(["conversation", "user_photos", "user_full"]),
  targetEntityId: z.string().min(1),
  reason: z.enum([
    "active_report_investigation",
    "user_appeal",
    "scam_spam_investigation",
    "impersonation_investigation",
    "safety_escalation",
    "legal_compliance_request",
    "quality_review",
    "other",
  ]),
  note: z.string().max(2000).optional().nullable(),
  reportId: z.string().optional().nullable(),
  redirectTo: z.string().min(1),
});

export async function grantSensitiveAccessAction(formData: FormData) {
  const parsed = grantSchema.safeParse({
    targetEntityType: formData.get("targetEntityType"),
    targetEntityId: formData.get("targetEntityId"),
    reason: formData.get("reason"),
    note: formData.get("note") || null,
    reportId: formData.get("reportId") || null,
    redirectTo: formData.get("redirectTo"),
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const required =
    data.targetEntityType === "conversation"
      ? "message.read.all"
      : data.targetEntityType === "user_photos"
        ? "photo.read.all"
        : "user.read.private_fields";
  const session = await requirePermission(required);
  if (data.reason === "other" && !data.note?.trim()) {
    return { ok: false as const, error: "Note is required when reason is Other" };
  }

  const grant: SensitiveAccessGrant = {
    id: newId("grant"),
    adminUserId: session.adminUserId,
    targetEntityType: data.targetEntityType,
    targetEntityId: data.targetEntityId,
    reason: data.reason as AccessReason,
    note: data.note ?? null,
    reportId: data.reportId ?? null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + GRANT_TTL_MINUTES * 60 * 1000).toISOString(),
  };
  insertGrant(grant);

  await writeAudit({
    session,
    eventType: "access_reason.granted",
    targetEntityType: data.targetEntityType,
    targetEntityId: data.targetEntityId,
    accessReason: grant.reason,
    reportId: data.reportId ?? null,
    internalNote: data.note ?? null,
    metadata: { grantId: grant.id, expiresAt: grant.expiresAt },
  });

  revalidatePath(data.redirectTo);
  return { ok: true as const, grantId: grant.id, redirectTo: data.redirectTo };
}

export async function hasActiveGrantFor(
  adminUserId: string,
  targetEntityType: SensitiveAccessGrant["targetEntityType"],
  targetEntityId: string,
): Promise<SensitiveAccessGrant | undefined> {
  return findActiveGrant(adminUserId, targetEntityType, targetEntityId);
}
