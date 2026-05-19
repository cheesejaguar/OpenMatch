import Sparkline from "./Sparkline";

// MetricCard — Botanic-styled tile for a single metric. Composes the
// existing `.metric` class for layout, then layers the delta-vs-prior
// pill and an inline sparkline. `improveDirection` controls whether a
// positive delta is shown as green (up = good, e.g. signups) or red
// (up = bad, e.g. error rate); this matters because operators read
// glance-level color first and number second.

export type ImproveDirection = "up" | "down";

export interface MetricCardProps {
  label: string;
  value: string | number;
  /** Percent change vs. prior period. Pass undefined to omit. */
  deltaPercent?: number;
  /** Recent values for the sparkline. Pass undefined to omit. */
  sparkline?: number[];
  /** Which direction counts as an improvement. Defaults to "up". */
  improveDirection?: ImproveDirection;
  /** Optional helper line under the value. */
  caption?: string;
}

function formatDelta(deltaPercent: number): string {
  const sign = deltaPercent > 0 ? "+" : deltaPercent < 0 ? "−" : "±";
  return `${sign}${Math.abs(deltaPercent).toFixed(1)}%`;
}

export default function MetricCard({
  label,
  value,
  deltaPercent,
  sparkline,
  improveDirection = "up",
  caption,
}: MetricCardProps) {
  let deltaColor = "var(--fg-muted)";
  if (deltaPercent !== undefined && deltaPercent !== 0) {
    const isUp = deltaPercent > 0;
    const isGood = (isUp && improveDirection === "up") || (!isUp && improveDirection === "down");
    deltaColor = isGood ? "var(--success)" : "var(--danger)";
  }

  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div
        className="value"
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span>{value}</span>
        {sparkline && sparkline.length > 1 ? (
          <Sparkline data={sparkline} ariaLabel={`${label} trend`} />
        ) : null}
      </div>
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
        {deltaPercent !== undefined ? (
          <span
            role="status"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: deltaColor,
              letterSpacing: "0.02em",
            }}
            aria-label={`${formatDelta(deltaPercent)} vs prior period`}
          >
            {formatDelta(deltaPercent)}
          </span>
        ) : null}
        {caption ? <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{caption}</span> : null}
      </div>
    </div>
  );
}
