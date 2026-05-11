"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { getAdminUserById, listAdminUsers, updateAdminUser } from "@/lib/data/store";
import { ROLES, type RoleName } from "@/lib/auth/permissions";

const ROLE_ENUM = Object.keys(ROLES) as [RoleName, ...RoleName[]];

const setRolesSchema = z.object({
  adminUserId: z.string().min(1),
  roles: z.array(z.enum(ROLE_ENUM)).min(1),
});

export async function setAdminRolesAction(formData: FormData) {
  const session = await requirePermission("admin.manage_roles");
  const rolesRaw = formData.getAll("roles");
  const parsed = setRolesSchema.safeParse({
    adminUserId: formData.get("adminUserId"),
    roles: rolesRaw,
  });
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const target = getAdminUserById(parsed.data.adminUserId);
  if (!target) return { ok: false as const, error: "Admin not found" };

  // Prevent locking the system out: don't allow removing the last system_admin role.
  if (target.roles.includes("system_admin") && !parsed.data.roles.includes("system_admin")) {
    const otherSysAdmins = listAdminUsers().filter(
      (a) => a.id !== target.id && a.status === "active" && a.roles.includes("system_admin"),
    );
    if (otherSysAdmins.length === 0) {
      return { ok: false as const, error: "Cannot remove the last active System Admin role" };
    }
  }

  const previousRoles = [...target.roles];
  updateAdminUser(target.id, { roles: parsed.data.roles });
  await writeAudit({
    session,
    eventType: "admin.role_changed",
    targetEntityType: "admin_user",
    targetEntityId: target.id,
    metadata: { previousRoles, newRoles: parsed.data.roles },
  });
  revalidatePath("/settings");
  return { ok: true as const };
}
