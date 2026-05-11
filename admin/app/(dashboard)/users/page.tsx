import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";
import { requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { listReportsByUserId, listUsers } from "@/lib/data/store";

type SP = {
  q?: string;
  status?: string;
  verification?: string;
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePermission("user.read.summary");
  const sp = await searchParams;
  const users = listUsers({
    query: sp.q,
    status: sp.status as never,
    verification: sp.verification as never,
  });
  if (sp.q) {
    await writeAudit({
      session,
      eventType: "user.searched",
      targetEntityType: "user_search",
      targetEntityId: null,
      metadata: { query: sp.q, results: users.length },
    });
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Search and manage accounts. Sensitive fields are masked unless your role permits."
      />
      <form className="card p-4 flex flex-wrap gap-3 items-end mb-4" method="get">
        <div className="grow min-w-[220px]">
          <label className="label" htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            defaultValue={sp.q ?? ""}
            className="field"
            placeholder="User ID, profile ID, display name, city…"
          />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""} className="field">
            <option value="">Any</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="suspended">suspended</option>
            <option value="banned">banned</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="verification">Verification</label>
          <select
            id="verification"
            name="verification"
            defaultValue={sp.verification ?? ""}
            className="field"
          >
            <option value="">Any</option>
            <option value="verified">verified</option>
            <option value="pending">pending</option>
            <option value="unverified">unverified</option>
          </select>
        </div>
        <button type="submit" className="btn-primary">Apply</button>
      </form>

      {users.length === 0 ? (
        <Empty title="No users found." hint="Try a different query or clear filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Verification</th>
                <th>Moderation</th>
                <th>City</th>
                <th>Reports</th>
                <th>Created</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/users/${u.id}`} className="font-medium">
                      {u.displayName}
                    </Link>
                    <div className="text-xs text-ink-500">{u.id}</div>
                  </td>
                  <td><StatusBadge value={u.status} /></td>
                  <td><StatusBadge value={u.verificationStatus} /></td>
                  <td><StatusBadge value={u.moderationStatus} /></td>
                  <td>{u.city ?? "—"}</td>
                  <td>{listReportsByUserId(u.id).filter((r) => r.reportedUserId === u.id).length}</td>
                  <td className="text-ink-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="text-ink-500">{new Date(u.lastActiveAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
