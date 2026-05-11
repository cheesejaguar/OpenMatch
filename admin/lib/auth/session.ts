import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  PERMISSIONS,
  ROLES,
  SENSITIVE_PERMISSIONS,
  type Permission,
  type RoleName,
  permissionsForRoles,
} from "./permissions";
import { getAdminUserById } from "@/lib/data/store";

const SESSION_COOKIE = "om_admin_session";

export type AdminSession = {
  adminUserId: string;
  email: string;
  displayName: string;
  roles: RoleName[];
  permissions: Set<Permission>;
};

export async function readSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE)?.value;
  if (!value) return null;

  // Phase 0 prototype session: cookie holds adminUserId. A real deployment
  // replaces this with verified OIDC/SSO session tokens (PRD §6.1).
  const admin = getAdminUserById(value);
  if (!admin || admin.status !== "active") return null;

  return {
    adminUserId: admin.id,
    email: admin.email,
    displayName: admin.displayName,
    roles: admin.roles,
    permissions: permissionsForRoles(admin.roles),
  };
}

export async function requireSession(): Promise<AdminSession> {
  const session = await readSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permission: Permission): Promise<AdminSession> {
  const session = await requireSession();
  if (!session.permissions.has(permission)) {
    redirect(`/forbidden?missing=${encodeURIComponent(permission)}`);
  }
  return session;
}

export function hasPermission(session: AdminSession, permission: Permission): boolean {
  return session.permissions.has(permission);
}

export function isSensitive(permission: Permission): boolean {
  return SENSITIVE_PERMISSIONS.has(permission);
}

export async function setSessionCookie(adminUserId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, adminUserId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function clientMetadata(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { ip, userAgent: h.get("user-agent") };
}

export const ALL_PERMISSIONS = PERMISSIONS;
export const ALL_ROLES = ROLES;
