import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requireSession } from "@/lib/auth/session";
import { listReports, overviewMetrics } from "@/lib/data/store";

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint ? <div className="text-xs text-ink-500 mt-1">{hint}</div> : null}
    </div>
  );
}

export default async function OverviewPage() {
  const session = await requireSession();
  const m = overviewMetrics();
  const recent = listReports().slice(0, 6);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${session.displayName.split(" ")[0]}.`}
        subtitle="Operational snapshot. All sensitive actions are audit-logged."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Open reports" value={m.openReports} />
        <Metric label="Escalated" value={m.escalatedReports} />
        <Metric label="Avg report age" value={`${m.averageReportAgeHours}h`} />
        <Metric label="Photo queue" value={m.photoQueue} />
        <Metric label="New users (24h)" value={m.newUsers24h} />
        <Metric label="Bans (24h)" value={m.bannedUsers24h} />
        <Metric label="Suspended" value={m.suspendedUsers} />
        <Metric label="Actions today" value={m.actionsToday} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-ink-700 mb-3">Open reports by severity</h2>
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between"><span>Critical</span><StatusBadge value="critical" /><span>{m.reportsBySeverity.critical}</span></li>
            <li className="flex justify-between"><span>High</span><StatusBadge value="high" /><span>{m.reportsBySeverity.high}</span></li>
            <li className="flex justify-between"><span>Medium</span><StatusBadge value="medium" /><span>{m.reportsBySeverity.medium}</span></li>
            <li className="flex justify-between"><span>Low</span><StatusBadge value="low" /><span>{m.reportsBySeverity.low}</span></li>
          </ul>
        </div>
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-ink-700 mb-3">Open reports by category</h2>
          <ul className="space-y-1 text-sm">
            {Object.entries(m.reportsByCategory).map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span>{k.replaceAll("_", " ")}</span>
                <span>{v}</span>
              </li>
            ))}
            {Object.keys(m.reportsByCategory).length === 0 ? (
              <li className="text-ink-500">No open reports.</li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="card mt-6">
        <div className="flex justify-between items-center px-4 py-3 border-b border-ink-200">
          <h2 className="font-semibold text-ink-700">Recent reports</h2>
          <Link href="/reports" className="text-sm">View all →</Link>
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>Reason</th><th>Severity</th><th>Status</th><th>Created</th></tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/reports/${r.id}`}>{r.id}</Link></td>
                <td>{r.reason.replaceAll("_", " ")}</td>
                <td><StatusBadge value={r.severity} /></td>
                <td><StatusBadge value={r.status} /></td>
                <td className="text-ink-500">{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
