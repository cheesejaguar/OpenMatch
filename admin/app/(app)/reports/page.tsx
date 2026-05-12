import Link from "next/link";
import { adminFetch } from "../../../lib/api/admin-client";
import type { ReportSummaryDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ status?: string; reason?: string; cursor?: string }>;
}

export default async function ReportsPage({ searchParams }: Params) {
  const sp = await searchParams;
  const { data, status } = await adminFetch<{
    reports: ReportSummaryDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/reports", {
    query: {
      status: sp.status,
      reason: sp.reason,
      cursor: sp.cursor,
      limit: 50,
    },
  });

  return (
    <div>
      <div className="page-header">
        <h2>Reports</h2>
      </div>
      <form className="toolbar" action="/reports" method="get">
        <div style={{ width: 160 }}>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Any</option>
            <option value="open">open</option>
            <option value="reviewing">reviewing</option>
            <option value="resolved">resolved</option>
            <option value="dismissed">dismissed</option>
          </select>
        </div>
        <div style={{ width: 200 }}>
          <label htmlFor="reason">Reason</label>
          <input id="reason" name="reason" defaultValue={sp.reason ?? ""} />
        </div>
        <button type="submit" className="primary">
          Filter
        </button>
      </form>

      {status !== 200 ? (
        <div className="error">Failed to load ({status}).</div>
      ) : data.reports.length === 0 ? (
        <div className="card muted">No reports match.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Reporter</th>
                <th>Reported</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/reports/${r.id}`}>{r.id.slice(0, 10)}…</Link>
                  </td>
                  <td>
                    <span className={`badge ${r.status}`}>{r.status}</span>
                  </td>
                  <td>{r.reason}</td>
                  <td>
                    <Link href={`/users/${r.reporter.userId}`}>
                      {r.reporter.displayName ?? r.reporter.userId.slice(0, 6)}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/users/${r.reported.userId}`}>
                      {r.reported.displayName ?? r.reported.userId.slice(0, 6)}
                    </Link>
                  </td>
                  <td className="muted">{r.createdAt.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link href={{ pathname: "/reports", query: { ...sp, cursor: data.nextCursor } }}>
            Next page →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
