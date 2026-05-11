import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";
import { requirePermission } from "@/lib/auth/session";
import { getAdminUserById, getUserById, listReports } from "@/lib/data/store";
import { REASON_CODES } from "@/lib/data/types";

type SP = {
  status?: string;
  reason?: string;
  contentType?: string;
  assignedTo?: string;
  view?: string;
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requirePermission("report.read.all");
  const sp = await searchParams;
  const view = sp.view ?? "queue";

  const filters: Parameters<typeof listReports>[0] = {};
  if (view === "assigned_to_me") filters.assignedTo = session.adminUserId;
  if (view === "escalated") filters.status = "escalated";
  if (view === "resolved") filters.status = "resolved";
  if (view === "dismissed") filters.status = "dismissed";

  if (sp.status) filters.status = sp.status as never;
  if (sp.reason) filters.reason = sp.reason as never;
  if (sp.contentType) filters.contentType = sp.contentType as never;
  if (sp.assignedTo) filters.assignedTo = sp.assignedTo;

  const reports = listReports(filters);

  const Tab = ({ value, label }: { value: string; label: string }) => (
    <Link
      href={`/reports?view=${value}`}
      className={`px-3 py-1.5 text-sm rounded-md ${
        view === value ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-100"
      } no-underline`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Triage and resolve user reports. Resolution reasons are audit-logged."
      />
      <div className="flex gap-1 mb-4">
        <Tab value="queue" label="Queue" />
        <Tab value="assigned_to_me" label="Assigned to me" />
        <Tab value="escalated" label="Escalated" />
        <Tab value="resolved" label="Resolved" />
        <Tab value="dismissed" label="Dismissed" />
      </div>

      <form method="get" className="card p-4 flex flex-wrap gap-3 items-end mb-4">
        <input type="hidden" name="view" value={view} />
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""} className="field">
            <option value="">Any</option>
            <option value="open">open</option>
            <option value="reviewing">reviewing</option>
            <option value="escalated">escalated</option>
            <option value="resolved">resolved</option>
            <option value="dismissed">dismissed</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="reason">Reason</label>
          <select id="reason" name="reason" defaultValue={sp.reason ?? ""} className="field">
            <option value="">Any</option>
            {REASON_CODES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="contentType">Content type</label>
          <select id="contentType" name="contentType" defaultValue={sp.contentType ?? ""} className="field">
            <option value="">Any</option>
            <option value="profile">profile</option>
            <option value="photo">photo</option>
            <option value="message">message</option>
          </select>
        </div>
        <button type="submit" className="btn-primary">Apply</button>
      </form>

      {reports.length === 0 ? (
        <Empty title="No reports match your filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Reporter</th>
                <th>Reported</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const reporter = getUserById(r.reporterUserId);
                const reported = getUserById(r.reportedUserId);
                const assignee = r.assignedAdminUserId
                  ? getAdminUserById(r.assignedAdminUserId)
                  : null;
                return (
                  <tr key={r.id}>
                    <td><Link href={`/reports/${r.id}`}>{r.id}</Link></td>
                    <td>{reporter?.displayName ?? r.reporterUserId}</td>
                    <td>{reported?.displayName ?? r.reportedUserId}</td>
                    <td>{r.contentType}</td>
                    <td>{r.reason.replaceAll("_", " ")}</td>
                    <td><StatusBadge value={r.severity} /></td>
                    <td><StatusBadge value={r.status} /></td>
                    <td>{assignee?.displayName ?? "—"}</td>
                    <td className="text-ink-500">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
