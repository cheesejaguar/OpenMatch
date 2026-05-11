import { adminFetch } from "../../../../lib/api/admin-client";
import { createAdminAction } from "../../../../server/actions/admins";

async function handleCreateAdmin(formData: FormData) {
  "use server";
  await createAdminAction(formData);
}

export const dynamic = "force-dynamic";

interface RolesResponse {
  roles: Array<{ id: string; name: string; description: string; permissions: string[] }>;
}
interface AdminsResponse {
  admins: Array<{
    id: string;
    email: string;
    displayName: string;
    status: string;
    createdAt: string;
    lastLoginAt: string | null;
    roleNames: string[];
  }>;
}

export default async function AdminUsersPage() {
  const [rolesRes, adminsRes] = await Promise.all([
    adminFetch<RolesResponse>("/api/v1/admin/roles"),
    adminFetch<AdminsResponse>("/api/v1/admin/admin-users"),
  ]);
  if (rolesRes.status === 403 || adminsRes.status === 403) {
    return (
      <div>
        <div className="page-header">
          <h2>Admin users</h2>
        </div>
        <div className="error">You don&apos;t have permission to manage admin users.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="page-header">
        <h2>Admin users</h2>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Invite admin</h3>
        <form action={handleCreateAdmin}>
          <div className="grid cols-2">
            <div>
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required />
            </div>
            <div>
              <label htmlFor="displayName">Display name</label>
              <input id="displayName" name="displayName" required />
            </div>
          </div>
          <label htmlFor="roleNames" style={{ marginTop: 12 }}>
            Roles (comma-separated). Available: {rolesRes.data.roles.map((r) => r.name).join(", ")}
          </label>
          <input id="roleNames" name="roleNames" placeholder="moderator" />
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="primary">
              Create admin
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Status</th>
              <th>Roles</th>
              <th>Last login</th>
            </tr>
          </thead>
          <tbody>
            {adminsRes.data.admins.map((a) => (
              <tr key={a.id}>
                <td>{a.email}</td>
                <td>{a.displayName}</td>
                <td>
                  <span className={`badge ${a.status}`}>{a.status}</span>
                </td>
                <td>{a.roleNames.join(", ") || <span className="muted">none</span>}</td>
                <td className="muted">{a.lastLoginAt?.slice(0, 16) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Role catalog</h3>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Description</th>
              <th>Permissions</th>
            </tr>
          </thead>
          <tbody>
            {rolesRes.data.roles.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                </td>
                <td>{r.description}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {r.permissions.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
