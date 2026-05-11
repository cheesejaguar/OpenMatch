"use server";

import { revalidatePath } from "next/cache";
import { adminFetch } from "../../lib/api/admin-client";

export async function photoActionAction(
  photoId: string,
  action: "approve" | "reject" | "remove",
  reasonCode: string,
  internalNote: string,
) {
  const res = await adminFetch(`/api/v1/admin/photos/${photoId}/${action}`, {
    method: "POST",
    body: { reasonCode, internalNote },
  });
  if (res.status >= 400) return { ok: false as const, status: res.status, data: res.data };
  revalidatePath("/photos");
  return { ok: true as const };
}
