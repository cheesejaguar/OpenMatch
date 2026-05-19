import Link from "next/link";
import { adminFetch } from "../../../lib/api/admin-client";
import type { ReportSummaryDTO } from "../../../lib/api/types";
import { formatAge, slaBadgeClass, slaLabel, slaState } from "../../../lib/sla";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ status?: string; reason?: string; cursor?: string }>;
}

export default async function ReportsPage({ searchParams }: Params) {
  const sp = await searchParams;
  const res = await adminFetch<{
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
  const data = res.ok ? res.data : null;
  const status = res.status;

  // Oldest 5 open reports — pulled from a second, narrower fetch so
  // the panel reflects "oldest globally" instead of "oldest on this
  // filter page".
  const oldestRes = res.ok
    ? await adminFetch<{ reports: ReportSummaryDTO[] }>("/api/v1/admin/reports", {
        query: { status: "open", limit: 5 },
      })
    : null;
  const oldestSource = oldestRes && oldestRes.ok ? oldestRes.data.reports : [];
  const oldest = oldestSource
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, 5);

  const now = new Date();

  return (
    <div>
      <div className="page-header">
        <h2>Reports</h2>
      </div>

      {oldest.length > 0 ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Oldest open reports</h3>
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Reason</th>
                <th>Age</th>
                <th>SLA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {oldest.map((r) => {
                const st = slaState(r.createdAt, undefined, now);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/reports/${r.id}`}>{r.id.slice(0, 10)}…</Link>
                    </td>
                    <td>{r.reason}</td>
                    <td>{formatAge(r.createdAt, now)}</td>
                    <td>
                      <span className={slaBadgeClass(st)}>{slaLabel(st)}</span>
                    </td>
                    <td>
                      <Link href={`/reports/${r.id}`} style={{ fontSize: 12, fontWeight: 600 }}>
                        Resolve →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

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

      {!res.ok ? (
        <div className="error">
          Failed to load ({status} {res.error.code}).
        </div>
      ) : data!.reports.length === 0 ? (
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
                <th>Age</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {data!.reports.map((r) => {
                // SLA only applies while the report is open / reviewing.
                const isOpen = r.status === "open" || r.status === "reviewing";
                const st = isOpen ? slaState(r.createdAt, undefined, now) : null;
                return (
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
                    <td>{formatAge(r.createdAt, now)}</td>
                    <td>
                      {st ? (
                        <span className={slaBadgeClass(st)}>{slaLabel(st)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
