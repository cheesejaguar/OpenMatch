import Link from "next/link";
import { Suspense } from "react";
import Skeleton from "../../../components/ui/Skeleton";
import { adminFetch } from "../../../lib/api/admin-client";
import type { ReportSummaryDTO } from "../../../lib/api/types";
import { formatAge, slaBadgeClass, slaLabel, slaState } from "../../../lib/sla";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ status?: string; reason?: string; cursor?: string }>;
}

// PERF-A1 / PERF-A2: the "oldest open" panel and the filtered list are
// independent queries — render the toolbar shell + heading immediately
// and stream each panel in its own Suspense boundary so neither one
// blocks the other (or the page chrome).
export default async function ReportsPage({ searchParams }: Params) {
  const sp = await searchParams;
  const filterKey = `${sp.status ?? ""}|${sp.reason ?? ""}|${sp.cursor ?? ""}`;

  return (
    <div>
      <div className="page-header">
        <h2>Reports</h2>
      </div>

      <Suspense fallback={<OldestReportsSkeleton />}>
        <OldestReports />
      </Suspense>

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

      <Suspense key={filterKey} fallback={<ReportsTableSkeleton />}>
        <ReportsTable status={sp.status} reason={sp.reason} cursor={sp.cursor} spForLinks={sp} />
      </Suspense>
    </div>
  );
}

function OldestReportsSkeleton() {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Oldest open reports</h3>
      <Skeleton height={120} />
    </div>
  );
}

async function OldestReports() {
  const res = await adminFetch<{ reports: ReportSummaryDTO[] }>("/api/v1/admin/reports", {
    query: { status: "open", limit: 5 },
  });
  const source = res.ok ? res.data.reports : [];
  const oldest = source
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, 5);
  if (oldest.length === 0) return null;
  const now = new Date();
  return (
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
  );
}

function ReportsTableSkeleton() {
  return (
    <div className="card" style={{ padding: 0 }}>
      <Skeleton height={320} />
    </div>
  );
}

async function ReportsTable({
  status,
  reason,
  cursor,
  spForLinks,
}: {
  status: string | undefined;
  reason: string | undefined;
  cursor: string | undefined;
  spForLinks: { status?: string; reason?: string; cursor?: string };
}) {
  const res = await adminFetch<{
    reports: ReportSummaryDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/reports", {
    query: { status, reason, cursor, limit: 50 },
  });
  if (!res.ok) {
    return (
      <div className="error">
        Failed to load ({res.status} {res.error.code}).
      </div>
    );
  }
  const data = res.data;
  if (data.reports.length === 0) {
    return <div className="card muted">No reports match.</div>;
  }
  const now = new Date();
  return (
    <>
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
            {data.reports.map((r) => {
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

      {data.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link href={{ pathname: "/reports", query: { ...spForLinks, cursor: data.nextCursor } }}>
            Next page →
          </Link>
        </div>
      ) : null}
    </>
  );
}
