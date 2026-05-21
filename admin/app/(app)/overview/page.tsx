import { Suspense } from "react";
import Skeleton from "../../../components/ui/Skeleton";
import { adminFetch } from "../../../lib/api/admin-client";
import type { ModerationSummaryDTO, OverviewMetricsDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

// PERF-A1: split the overview's data fetch into a child server
// component so the page shell (heading + grid skeleton) streams
// immediately and the metrics fetch streams in when ready.
export default function OverviewPage() {
  return (
    <div>
      <div className="page-header">
        <h2>Overview</h2>
      </div>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewMetrics />
      </Suspense>
      <Suspense fallback={null}>
        <ModerationSummaryWidget />
      </Suspense>
    </div>
  );
}

// Trust & safety automation — scam-signals-per-hour widget. Renders
// the heuristic moderator + rule-based scam signals over the last 24h
// so an operator can spot bursts at a glance.
async function ModerationSummaryWidget() {
  const res = await adminFetch<ModerationSummaryDTO>("/api/v1/admin/moderation/summary", {
    query: { hours: 24 },
  });
  if (!res.ok) return null;
  const d = res.data;
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Safety signals (24h)</h3>
      <div className="grid cols-3" style={{ marginBottom: 12 }}>
        <div className="metric">
          <div className="label">Heuristic flags</div>
          <div className="value">{d.moderationFlagCount}</div>
        </div>
        <div className="metric">
          <div className="label">Scam-rule signals</div>
          <div className="value">{d.scamSignalCount}</div>
        </div>
        <div className="metric">
          <div className="label">Window</div>
          <div className="value">{d.windowHours}h</div>
        </div>
      </div>
      {d.topReasons.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Reason</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {d.topReasons.map((r) => (
              <tr key={r.reasonCode}>
                <td>
                  <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{r.reasonCode}</code>
                </td>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">No flags in the last {d.windowHours}h.</div>
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <div className="grid cols-3">
        {Array.from({ length: 8 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: pure-shape skeleton, never reorders
          <div key={i} className="metric">
            <div className="label">
              <Skeleton width={120} height={12} />
            </div>
            <div className="value">
              <Skeleton width={80} height={28} />
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Open reports by reason</h3>
        <Skeleton height={120} />
      </div>
    </>
  );
}

async function OverviewMetrics() {
  const res = await adminFetch<OverviewMetricsDTO>("/api/v1/admin/metrics/overview");
  if (!res.ok) {
    return (
      <div className="error">
        Unable to load metrics ({res.status} {res.error.code}).
      </div>
    );
  }
  const data = res.data;
  const tiles: Array<{ label: string; value: string | number }> = [
    { label: "Open reports", value: data.openReports },
    {
      label: "Avg open-report age",
      value: data.averageOpenReportAgeHours
        ? `${data.averageOpenReportAgeHours.toFixed(1)} h`
        : "—",
    },
    { label: "New users (24h)", value: data.newUsers24h },
    { label: "Banned today", value: data.bannedToday },
    { label: "Active suspensions", value: data.activeSuspensions },
    { label: "Photo queue", value: data.photoModerationQueue },
    { label: "Escalated reports", value: data.escalatedReports },
    { label: "Admin actions today", value: data.adminActionsToday },
  ];
  return (
    <>
      <div className="grid cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="metric">
            <div className="label">{t.label}</div>
            <div className="value">{t.value}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Open reports by reason</h3>
        {data.reportsByReason.length === 0 ? (
          <div className="muted">No open reports.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reason</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.reportsByReason.map((r) => (
                <tr key={r.reason}>
                  <td>{r.reason}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
