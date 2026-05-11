import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";
import { requirePermission } from "@/lib/auth/session";
import { getAdminUserById, listAdminUsers, listAuditEvents } from "@/lib/data/store";

type SP = {
  adminUserId?: string;
  targetEntityId?: string;
  eventType?: string;
  fromDate?: string;
  toDate?: string;
};

const EVENT_TYPES = [
  "auth.login",
  "auth.logout",
  "user.viewed",
  "user.searched",
  "report.viewed",
  "report.assigned",
  "report.resolved",
  "report.escalated",
  "user.banned",
  "user.unbanned",
  "user.suspended",
  "photo.action",
  "conversation.viewed",
  "note.added",
  "admin.role_changed",
  "access_reason.granted",
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("audit.read");
  const sp = await searchParams;
  const events = listAuditEvents({
    adminUserId: sp.adminUserId || undefined,
    targetEntityId: sp.targetEntityId || undefined,
    eventType: (sp.eventType as never) || undefined,
    fromDate: sp.fromDate || undefined,
    toDate: sp.toDate || undefined,
  });
  const admins = listAdminUsers();

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Append-only record of every sensitive admin read or write."
      />
      <form className="card p-4 grid md:grid-cols-5 gap-3 mb-4" method="get">
        <div>
          <label className="label" htmlFor="adminUserId">Admin</label>
          <select id="adminUserId" name="adminUserId" defaultValue={sp.adminUserId ?? ""} className="field">
            <option value="">Any</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="eventType">Event type</label>
          <select id="eventType" name="eventType" defaultValue={sp.eventType ?? ""} className="field">
            <option value="">Any</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="targetEntityId">Target ID</label>
          <input id="targetEntityId" name="targetEntityId" defaultValue={sp.targetEntityId ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="fromDate">From</label>
          <input type="datetime-local" id="fromDate" name="fromDate" defaultValue={sp.fromDate ?? ""} className="field" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary">Apply</button>
        </div>
      </form>

      {events.length === 0 ? (
        <Empty title="No audit events match your filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Event</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Report</th>
                <th>Note</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="text-ink-500 whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td>{getAdminUserById(e.adminUserId)?.displayName ?? e.adminUserId}</td>
                  <td><code className="text-xs">{e.eventType}</code></td>
                  <td>
                    {e.targetEntityType ? (
                      <div>
                        <div className="text-xs text-ink-500">{e.targetEntityType}</div>
                        <div className="text-sm">{e.targetEntityId ?? "—"}</div>
                      </div>
                    ) : "—"}
                  </td>
                  <td className="text-xs">{e.accessReason ?? "—"}</td>
                  <td className="text-xs">{e.reportId ?? "—"}</td>
                  <td className="text-xs max-w-md truncate">{e.internalNote ?? "—"}</td>
                  <td className="text-xs">{e.ipAddress ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-500 mt-3">
        Audit log is append-only. No admin can edit or delete entries from the dashboard.
      </p>
    </>
  );
}
