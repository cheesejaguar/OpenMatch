import Badge from "../../../components/ui/Badge";
import EmptyState from "../../../components/ui/EmptyState";
import TimeSeriesChart from "../../../components/ui/TimeSeriesChart";
import { adminFetch } from "../../../lib/api/admin-client";
import type { HealthSnapshotDTO, HealthStatus, TimeSeriesDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<HealthStatus, "success" | "warning" | "danger" | "default"> = {
  ok: "success",
  degraded: "warning",
  down: "danger",
  unknown: "default",
};

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1) return "<1 ms";
  return `${Math.round(ms)} ms`;
}

function statusLabel(s: HealthStatus): string {
  switch (s) {
    case "ok":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "down":
      return "Down";
    default:
      return "Unknown";
  }
}

export default async function HealthPage() {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // Both endpoints are R2A — graceful degrade on 404.
  const [snapshot, requests] = await Promise.all([
    adminFetch<HealthSnapshotDTO>("/api/v1/admin/health/snapshot"),
    adminFetch<TimeSeriesDTO>("/api/v1/admin/metrics/timeseries", {
      query: {
        metric: "requests",
        granularity: "hour",
        from: from.toISOString(),
        to: now.toISOString(),
      },
    }),
  ]);

  const snapshotMissing = snapshot.status === 404;
  const requestsMissing = requests.status === 404;

  return (
    <div>
      <div className="page-header">
        <h2>System health</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {snapshotMissing
            ? "Snapshot endpoint not yet deployed"
            : `Generated ${snapshot.data.generatedAt?.slice(11, 19) ?? "—"} UTC`}
        </span>
      </div>

      {snapshotMissing ? (
        <EmptyState
          title="Backend health endpoints not deployed yet"
          description="The /admin/health/snapshot route is shipping in a sibling PR (Round 2A). Once that lands, this page will populate automatically with backend, Postgres, Ably and Redis status."
          tone="warning"
        />
      ) : snapshot.status !== 200 ? (
        <div className="error">Failed to load health snapshot ({snapshot.status}).</div>
      ) : (
        <>
          <div className="grid cols-3" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {(
              [
                ["Backend", snapshot.data.backend],
                ["Postgres", snapshot.data.postgres],
                ["Ably", snapshot.data.ably],
                ["Redis", snapshot.data.redis],
              ] as const
            ).map(([label, svc]) => (
              <div key={label} className="status-tile">
                <div className="label">{label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge variant={STATUS_VARIANT[svc.status]}>{statusLabel(svc.status)}</Badge>
                </div>
                <div className="latency">{formatLatency(svc.latencyMs)}</div>
              </div>
            ))}
          </div>

          <div className="grid cols-3" style={{ marginTop: 16 }}>
            <div className="metric">
              <div className="label">Open reports</div>
              <div className="value">{snapshot.data.queues.openReports}</div>
            </div>
            <div className="metric">
              <div className="label">Photos pending</div>
              <div className="value">{snapshot.data.queues.pendingPhotos}</div>
            </div>
            <div className="metric">
              <div className="label">DSA notices unacknowledged</div>
              <div className="value">{snapshot.data.queues.unacknowledgedDsa}</div>
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Requests per hour · last 24 h</h3>
        {requestsMissing ? (
          <EmptyState
            title="Timeseries endpoint not yet deployed"
            description="Round 2A ships /admin/metrics/timeseries. Once merged this chart will render request volume."
            tone="warning"
          />
        ) : requests.status !== 200 ? (
          <div className="error">Failed to load timeseries ({requests.status}).</div>
        ) : (
          <TimeSeriesChart
            data={requests.data.points}
            xFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit" })}
            ariaLabel="Requests per hour"
          />
        )}
      </div>
    </div>
  );
}
