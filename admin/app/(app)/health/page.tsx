import Badge from "../../../components/ui/Badge";
import EmptyState from "../../../components/ui/EmptyState";
import TimeSeriesChart from "../../../components/ui/TimeSeriesChart";
import { adminFetch } from "../../../lib/api/admin-client";
import {
  type HealthSnapshotDTO,
  type HealthStatus,
  type ReadyCheckDTO,
  type TimeSeriesDTO,
  timeseriesToPoints,
} from "../../../lib/api/types";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<HealthStatus, "success" | "warning" | "danger" | "default"> = {
  ok: "success",
  degraded: "warning",
  down: "danger",
  unknown: "default",
};

function formatLatency(ms: number | null | undefined): string {
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

// Map R2A's ReadyCheckDTO ({ ok, configured, latencyMs }) into the
// status enum the UI uses. Unconfigured deps render as "Unknown" so
// operators don't mistake "no Ably integration" for "Ably is down".
function readyToStatus(check: ReadyCheckDTO | undefined): HealthStatus {
  if (!check) return "unknown";
  if (!check.configured) return "unknown";
  if (!check.ok) return "down";
  return "ok";
}

export default async function HealthPage() {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
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

  // Derive the per-service tile data from R2A's response shape.
  const data = snapshot.ok ? snapshot.data : null;
  const checks = data?.ready?.checks;
  // Backend is "ok" as long as we got a 200 — the API itself answered.
  const backendStatus: HealthStatus = data ? "ok" : "unknown";
  const services: Array<{ label: string; status: HealthStatus; latencyMs: number | null }> = [
    { label: "Backend", status: backendStatus, latencyMs: null },
    {
      label: "Postgres",
      status: readyToStatus(checks?.postgres),
      latencyMs: checks?.postgres?.latencyMs ?? null,
    },
    {
      label: "Ably",
      status: readyToStatus(checks?.ably),
      latencyMs: checks?.ably?.latencyMs ?? null,
    },
    {
      label: "Redis",
      status: readyToStatus(checks?.redis),
      latencyMs: checks?.redis?.latencyMs ?? null,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>System health</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {snapshotMissing
            ? "Snapshot endpoint not yet deployed"
            : data?.ready?.checkedAt
              ? `Checked ${data.ready.checkedAt.slice(11, 19)} UTC`
              : ""}
        </span>
      </div>

      {snapshotMissing ? (
        <EmptyState
          title="Backend health endpoints not deployed yet"
          description="The /admin/health/snapshot route is shipping in a sibling PR (Round 2A). Once that lands, this page will populate automatically with backend, Postgres, Ably and Redis status."
          tone="warning"
        />
      ) : !snapshot.ok || !data ? (
        <div className="error">
          Failed to load health snapshot ({snapshot.status}
          {!snapshot.ok ? ` ${snapshot.error.code}` : ""}).
        </div>
      ) : (
        <>
          <div className="grid cols-3" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {services.map((svc) => (
              <div key={svc.label} className="status-tile">
                <div className="label">{svc.label}</div>
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
              <div className="value">{data.queueDepths.reportsOpen}</div>
            </div>
            <div className="metric">
              <div className="label">Photos pending</div>
              <div className="value">{data.queueDepths.photosPending}</div>
            </div>
            <div className="metric">
              <div className="label">DSA notices unacknowledged</div>
              <div className="value">{data.queueDepths.dsaNoticesUnack}</div>
            </div>
          </div>

          <div className="grid cols-3" style={{ marginTop: 16 }}>
            <div className="metric">
              <div className="label">Error rate (5 min)</div>
              <div className="value">
                {data.errorRate5m == null ? "—" : `${(data.errorRate5m * 100).toFixed(2)}%`}
              </div>
            </div>
            <div className="metric">
              <div className="label">Pg pool usage</div>
              <div className="value">
                {data.postgres.poolUsage == null
                  ? "—"
                  : `${(data.postgres.poolUsage * 100).toFixed(0)}%`}
              </div>
            </div>
            <div className="metric">
              <div className="label">Pg connections</div>
              <div className="value">
                {data.postgres.activeConnections ?? "—"}
                {data.postgres.maxConnections ? ` / ${data.postgres.maxConnections}` : ""}
              </div>
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
        ) : !requests.ok ? (
          <div className="error">
            Failed to load timeseries ({requests.status} {requests.error.code}).
          </div>
        ) : (
          <TimeSeriesChart
            data={timeseriesToPoints(requests.data)}
            xFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit" })}
            ariaLabel="Requests per hour"
          />
        )}
      </div>
    </div>
  );
}
