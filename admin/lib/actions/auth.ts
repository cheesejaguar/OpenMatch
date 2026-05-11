"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clearSessionCookie,
  readSession,
  setSessionCookie,
} from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { getAdminUserById, listAdminUsers, updateAdminUser } from "@/lib/data/store";
import { permissionsForRoles } from "@/lib/auth/permissions";

const loginSchema = z.object({
  adminUserId: z.string().min(1),
});

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    adminUserId: formData.get("adminUserId"),
  });
  if (!parsed.success) {
    redirect("/login?error=invalid");
  }
  // Phase 0 demo SSO: select an admin identity. Production uses OIDC + MFA.
  const admin = getAdminUserById(parsed.data.adminUserId);
  if (!admin || admin.status !== "active") {
    redirect("/login?error=unknown");
  }

  await setSessionCookie(admin.id);
  updateAdminUser(admin.id, { lastLoginAt: new Date().toISOString() });
  await writeAudit({
    session: {
      adminUserId: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      roles: admin.roles,
      permissions: permissionsForRoles(admin.roles),
    },
    eventType: "auth.login",
    targetEntityType: "admin_user",
    targetEntityId: admin.id,
  });
  redirect("/overview");
}

export async function logoutAction(): Promise<void> {
  const session = await readSession();
  if (session) {
    await writeAudit({
      session,
      eventType: "auth.logout",
      targetEntityType: "admin_user",
      targetEntityId: session.adminUserId,
    });
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function listLoginIdentitiesAction() {
  return listAdminUsers().map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.displayName,
    roles: a.roles,
  }));
}
