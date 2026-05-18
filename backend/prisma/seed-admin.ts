import { PrismaClient } from "@prisma/client";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";

const prisma = new PrismaClient();

async function upsertRoles() {
  for (const role of ADMIN_ROLE_DEFINITIONS) {
    await prisma.adminRole.upsert({
      where: { name: role.name },
      create: { name: role.name, description: role.description, permissions: role.permissions },
      update: { description: role.description, permissions: role.permissions },
    });
  }
}

async function upsertAdmin(email: string) {
  const normalized = email.trim().toLowerCase();
  const displayName = normalized.split("@")[0] ?? "admin";
  const admin = await prisma.adminUser.upsert({
    where: { email: normalized },
    create: { email: normalized, displayName },
    update: {},
  });
  const systemAdminRole = await prisma.adminRole.findUnique({ where: { name: "system_admin" } });
  if (!systemAdminRole) {
    throw new Error("system_admin role missing — run upsertRoles() first");
  }
  await prisma.adminUserRole.upsert({
    where: {
      adminUserId_adminRoleId: { adminUserId: admin.id, adminRoleId: systemAdminRole.id },
    },
    create: { adminUserId: admin.id, adminRoleId: systemAdminRole.id },
    update: {},
  });
  return admin;
}

async function main() {
  const raw = process.env.ADMIN_ALLOWED_EMAILS ?? "cheesejaguar@gmail.com";
  const emails = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (emails.length === 0) {
    console.error("No emails provided. Set ADMIN_ALLOWED_EMAILS or pass via env.");
    process.exit(1);
  }

  await upsertRoles();
  for (const email of emails) {
    const a = await upsertAdmin(email);
    console.log(`granted system_admin to ${a.email} (id=${a.id})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
