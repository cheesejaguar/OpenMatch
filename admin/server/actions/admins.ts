"use server";

import { revalidatePath } from "next/cache";
import { type AdminApiError, adminFetch } from "../../lib/api/admin-client";

type ActionResult = { ok: true } | { ok: false; status: number; error: AdminApiError };

export async function createAdminAction(formData: FormData): Promise<ActionResult> {
  const body = {
    email: String(formData.get("email") ?? "").toLowerCase(),
    displayName: String(formData.get("displayName") ?? ""),
    roleNames: String(formData.get("roleNames") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const res = await adminFetch("/api/v1/admin/admin-users", { method: "POST", body });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath("/settings/admins");
  return { ok: true };
}

export async function setAdminRolesAction(
  adminUserId: string,
  formData: FormData,
): Promise<ActionResult> {
  const roleNames = formData.getAll("roleNames").map(String);
  const res = await adminFetch(`/api/v1/admin/admin-users/${adminUserId}/roles`, {
    method: "PUT",
    body: { roleNames },
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  revalidatePath("/settings/admins");
  return { ok: true };
}
