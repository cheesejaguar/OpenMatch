"use server";

import { revalidatePath } from "next/cache";
import { type AdminApiError, adminFetch } from "../../lib/api/admin-client";

export async function photoActionAction(
  photoId: string,
  action: "approve" | "reject" | "remove",
  reasonCode: string,
  internalNote: string,
): Promise<{ ok: true } | { ok: false; status: number; error: AdminApiError }> {
  const res = await adminFetch(`/api/v1/admin/photos/${photoId}/${action}`, {
    method: "POST",
    body: { reasonCode, internalNote },
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath("/photos");
  return { ok: true };
}
