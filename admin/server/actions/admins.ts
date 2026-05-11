"use server";

import { revalidatePath } from "next/cache";
import { adminFetch } from "../../lib/api/admin-client";

export async function createAdminAction(formData: FormData) {
  const body = {
    email: String(formData.get("email") ?? "").toLowerCase(),
    displayName: String(formData.get("displayName") ?? ""),
    roleNames: String(formData.get("roleNames") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const res = await adminFetch("/api/v1/admin/admin-users", { method: "POST", body });
  if (res.status >= 400) return { ok: false as const, status: res.status, data: res.data };
  revalidatePath("/settings/admins");
  return { ok: true as const };
}

export async function setAdminRolesAction(adminUserId: string, formData: FormData) {
  const roleNames = formData.getAll("roleNames").map(String);
  const res = await adminFetch(`/api/v1/admin/admin-users/${adminUserId}/roles`, {
    method: "PUT",
    body: { roleNames },
  });
  if (res.status >= 400) return { ok: false as const, status: res.status, data: res.data };
  revalidatePath("/settings/admins");
  return { ok: true as const };
}
