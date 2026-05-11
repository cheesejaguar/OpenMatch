import { adminFetch } from "../../../lib/api/admin-client";
import type { OverviewMetricsDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { data, status } = await adminFetch<OverviewMetricsDTO>("/api/v1/admin/metrics/overview");
  if (status !== 200) {
    return (
      <div>
        <div className="page-header">
          <h2>Overview</h2>
        </div>
        <div className="error">Unable to load metrics ({status}).</div>
      </div>
    );
  }
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
    <div>
      <div className="page-header">
        <h2>Overview</h2>
      </div>
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
    </div>
  );
}
