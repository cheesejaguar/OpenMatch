"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { newId } from "@/lib/data/ids";
import {
  activeBanForUser,
  getUserById,
  insertBan,
  insertModerationAction,
  insertNote,
  updateBan,
  updateUser,
} from "@/lib/data/store";
import type { ReasonCode, UserBan, UserRecord } from "@/lib/data/types";

const banSchema = z.object({
  userId: z.string().min(1),
  banType: z.enum(["temporary", "permanent", "safety_hold"]),
  reasonCode: z.enum([
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
  ]),
  internalNote: z.string().min(3, "Internal note required").max(2000),
  userFacingExplanation: z.string().max(2000).optional().nullable(),
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
  revokeSessions: z.coerce.boolean().optional(),
  reportId: z.string().optional().nullable(),
});

export async function banUserAction(formData: FormData) {
  const parsed = banSchema.safeParse({
    userId: formData.get("userId"),
    banType: formData.get("banType"),
    reasonCode: formData.get("reasonCode"),
    internalNote: formData.get("internalNote"),
    userFacingExplanation: formData.get("userFacingExplanation") || null,
    durationDays: formData.get("durationDays") || undefined,
    revokeSessions: formData.get("revokeSessions") === "on",
    reportId: formData.get("reportId") || null,
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const required =
    data.banType === "permanent" ? "user.ban.permanent" : "user.ban.temporary";
  const session = await requirePermission(required);

  const user = getUserById(data.userId);
  if (!user) return { ok: false as const, error: "User not found" };
  if (activeBanForUser(data.userId)) {
    return { ok: false as const, error: "User already has an active ban" };
  }

  const expiresAt =
    data.banType === "temporary" && data.durationDays
      ? new Date(Date.now() + data.durationDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const ban: UserBan = {
    id: newId("ban"),
    userId: data.userId,
    banType: data.banType,
    status: "active",
    reasonCode: data.reasonCode as ReasonCode,
    internalNote: data.internalNote,
    userFacingExplanation: data.userFacingExplanation ?? null,
    bannedByAdminUserId: session.adminUserId,
    bannedAt: new Date().toISOString(),
    expiresAt,
    unbannedByAdminUserId: null,
    unbannedAt: null,
    unbanReason: null,
  };
  insertBan(ban);
  updateUser(data.userId, {
    status: data.banType === "permanent" ? "banned" : "suspended",
    visibilityStatus: "hidden",
  });

  const action = {
    id: newId("modact"),
    targetUserId: data.userId,
    targetPhotoId: null,
    targetMessageId: null,
    reportId: data.reportId ?? null,
    actionType:
      data.banType === "permanent" ? ("permanent_ban" as const) : ("temporary_suspension" as const),
    reasonCode: data.reasonCode as ReasonCode,
    internalNote: data.internalNote,
    userFacingExplanation: data.userFacingExplanation ?? null,
    createdByAdminUserId: session.adminUserId,
    createdAt: new Date().toISOString(),
  };
  insertModerationAction(action);

  await writeAudit({
    session,
    eventType: data.banType === "permanent" ? "user.banned" : "user.suspended",
    targetEntityType: "user",
    targetEntityId: data.userId,
    reportId: data.reportId ?? null,
    moderationActionId: action.id,
    internalNote: data.internalNote,
    metadata: { banType: data.banType, reasonCode: data.reasonCode, expiresAt },
  });

  revalidatePath(`/users/${data.userId}`);
  revalidatePath("/users");
  if (data.reportId) revalidatePath(`/reports/${data.reportId}`);
  return { ok: true as const, banId: ban.id };
}

const unbanSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().min(3).max(1000),
  requireVerification: z.coerce.boolean().optional(),
  requireProfileReview: z.coerce.boolean().optional(),
});

export async function unbanUserAction(formData: FormData) {
  const parsed = unbanSchema.safeParse({
    userId: formData.get("userId"),
    reason: formData.get("reason"),
    requireVerification: formData.get("requireVerification") === "on",
    requireProfileReview: formData.get("requireProfileReview") === "on",
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const session = await requirePermission("user.unban");
  const data = parsed.data;

  const ban = activeBanForUser(data.userId);
  if (!ban) return { ok: false as const, error: "No active ban found" };

  updateBan(ban.id, {
    status: "lifted",
    unbannedByAdminUserId: session.adminUserId,
    unbannedAt: new Date().toISOString(),
    unbanReason: data.reason,
  });
  const userPatch: Partial<UserRecord> = {
    status: "active",
    visibilityStatus: data.requireProfileReview ? "hidden" : "visible",
  };
  if (data.requireVerification) userPatch.verificationStatus = "pending";
  updateUser(data.userId, userPatch);

  await writeAudit({
    session,
    eventType: "user.unbanned",
    targetEntityType: "user",
    targetEntityId: data.userId,
    internalNote: data.reason,
    metadata: {
      requireVerification: !!data.requireVerification,
      requireProfileReview: !!data.requireProfileReview,
      previousBanId: ban.id,
    },
  });

  revalidatePath(`/users/${data.userId}`);
  return { ok: true as const };
}

const noteSchema = z.object({
  targetEntityType: z.enum(["user", "report", "conversation"]),
  targetEntityId: z.string().min(1),
  body: z.string().min(1).max(4000),
});

export async function addInternalNoteAction(formData: FormData) {
  const parsed = noteSchema.safeParse({
    targetEntityType: formData.get("targetEntityType"),
    targetEntityId: formData.get("targetEntityId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const session = await requirePermission("note.write");
  const note = {
    id: newId("note"),
    targetEntityType: parsed.data.targetEntityType,
    targetEntityId: parsed.data.targetEntityId,
    body: parsed.data.body,
    createdByAdminUserId: session.adminUserId,
    createdAt: new Date().toISOString(),
  };
  insertNote(note);
  await writeAudit({
    session,
    eventType: "note.added",
    targetEntityType: parsed.data.targetEntityType,
    targetEntityId: parsed.data.targetEntityId,
    internalNote: parsed.data.body,
  });
  if (parsed.data.targetEntityType === "user") {
    revalidatePath(`/users/${parsed.data.targetEntityId}`);
  } else if (parsed.data.targetEntityType === "report") {
    revalidatePath(`/reports/${parsed.data.targetEntityId}`);
  } else {
    revalidatePath(`/conversations/${parsed.data.targetEntityId}`);
  }
  return { ok: true as const };
}

