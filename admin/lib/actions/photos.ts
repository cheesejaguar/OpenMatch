"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { newId } from "@/lib/data/ids";
import { getUserById, insertModerationAction, updateUser } from "@/lib/data/store";
import type { ModerationStatus, ReasonCode } from "@/lib/data/types";

const photoActionSchema = z.object({
  userId: z.string().min(1),
  photoId: z.string().min(1),
  action: z.enum(["approve", "reject", "remove", "escalate", "mark_safe"]),
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
  note: z.string().max(2000).optional().nullable(),
});

export async function actOnPhotoAction(formData: FormData) {
  const parsed = photoActionSchema.safeParse({
    userId: formData.get("userId"),
    photoId: formData.get("photoId"),
    action: formData.get("action"),
    reasonCode: (formData.get("reasonCode") as string | null) || null,
    note: formData.get("note") || null,
  });
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const session = await requirePermission("photo.action.review");
  const data = parsed.data;

  if ((data.action === "reject" || data.action === "remove") && !data.reasonCode) {
    return { ok: false as const, error: "Reason required for removal/rejection" };
  }

  const user = getUserById(data.userId);
  if (!user) return { ok: false as const, error: "User not found" };
  const photo = user.photos.find((p) => p.id === data.photoId);
  if (!photo) return { ok: false as const, error: "Photo not found" };

  const newStatus: ModerationStatus =
    data.action === "approve" || data.action === "mark_safe"
      ? "reviewed_ok"
      : data.action === "escalate"
        ? "under_review"
        : "removed";

  const updatedPhotos = user.photos.map((p) =>
    p.id === photo.id ? { ...p, moderationStatus: newStatus } : p,
  );
  updateUser(user.id, { photos: updatedPhotos });

  const action = {
    id: newId("modact"),
    targetUserId: user.id,
    targetPhotoId: photo.id,
    targetMessageId: null,
    reportId: null,
    actionType: "photo_removed" as const,
    reasonCode: (data.reasonCode as ReasonCode | null) ?? null,
    internalNote: data.note ?? data.action,
    userFacingExplanation: null,
    createdByAdminUserId: session.adminUserId,
    createdAt: new Date().toISOString(),
  };
  insertModerationAction(action);

  await writeAudit({
    session,
    eventType: "photo.action",
    targetEntityType: "photo",
    targetEntityId: photo.id,
    moderationActionId: action.id,
    internalNote: data.note ?? null,
    metadata: { action: data.action, reasonCode: data.reasonCode, userId: user.id },
  });

  revalidatePath(`/users/${user.id}`);
  revalidatePath("/photos");
  return { ok: true as const };
}
