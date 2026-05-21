"use server";

import { revalidatePath } from "next/cache";
import { type AdminApiError, adminFetch } from "../../lib/api/admin-client";

export async function resolveModerationFlagAction(
  flagId: string,
  resolution: "dismissed" | "warned" | "removed" | "banned",
): Promise<{ ok: true } | { ok: false; status: number; error: AdminApiError }> {
  const res = await adminFetch(`/api/v1/admin/moderation/flags/${flagId}/resolve`, {
    method: "POST",
    body: { resolution },
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath("/moderation/text");
  return { ok: true };
}

export async function decideVerificationAction(
  requestId: string,
  action: "approve" | "reject",
  decisionNote?: string,
): Promise<{ ok: true } | { ok: false; status: number; error: AdminApiError }> {
  const res = await adminFetch(`/api/v1/admin/verification/${requestId}/${action}`, {
    method: "POST",
    body: { decisionNote },
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath("/moderation/verification");
  return { ok: true };
}
