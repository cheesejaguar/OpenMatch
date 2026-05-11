import { PageHeader } from "@/components/PageHeader";
import { RoleManagementForm } from "@/components/RoleManagementForm";
import { hasPermission, requireSession } from "@/lib/auth/session";
import { ROLES } from "@/lib/auth/permissions";
import { listAdminUsers } from "@/lib/data/store";

export default async function SettingsPage() {
  const session = await requireSession();
  const canManage = hasPermission(session, "admin.manage_roles");
  const admins = listAdminUsers();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Admin roles and dashboard configuration."
      />
      <section className="card p-4">
        <h2 className="font-semibold text-ink-700 mb-3">Roles & permissions</h2>
        <p className="text-sm text-ink-500 mb-3">
          Each admin's effective permissions are the union of their assigned roles. Sensitive
          access additionally requires an access reason.
        </p>
        <table>
          <thead>
            <tr><th>Role</th><th>Description</th><th>Permissions</th></tr>
          </thead>
          <tbody>
            {Object.entries(ROLES).map(([name, r]) => (
              <tr key={name}>
                <td className="font-medium">{r.label}</td>
                <td>{r.description}</td>
                <td className="text-xs">
                  <div className="flex flex-wrap gap-1">
                    {r.permissions.map((p) => (
                      <span key={p} className="badge bg-ink-100 text-ink-700">{p}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4 mt-6">
        <h2 className="font-semibold text-ink-700 mb-3">Admin users</h2>
        {!canManage ? (
          <p className="text-sm text-ink-500">
            Read-only view. Role changes require <code>admin.manage_roles</code>.
          </p>
        ) : null}
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Status</th><th>Roles</th><th>Last login</th></tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td className="font-medium">{a.displayName}</td>
                <td>{a.email}</td>
                <td>{a.status}</td>
                <td>
                  {canManage ? (
                    <RoleManagementForm adminUserId={a.id} current={a.roles} />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {a.roles.map((r) => (
                        <span key={r} className="badge bg-ink-100 text-ink-700">{ROLES[r].label}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="text-ink-500">
                  {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4 mt-6">
        <h2 className="font-semibold text-ink-700 mb-3">Environment</h2>
        <ul className="text-sm space-y-1">
          <li>Deployment: <code>{process.env.VERCEL_ENV ?? "local"}</code></li>
          <li>Region: <code>{process.env.VERCEL_REGION ?? "—"}</code></li>
          <li>
            Admin API base:{" "}
            <code>{process.env.ADMIN_API_BASE_URL ?? "(unset, using mock store)"}</code>
          </li>
        </ul>
      </section>
    </>
  );
}
