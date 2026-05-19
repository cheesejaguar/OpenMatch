"use client";

import { useMemo, useState } from "react";

// TimeSeriesChart — hand-rolled line chart in raw SVG. No d3, no
// recharts. Supports either a single series via `data` or multiple
// series via `series`. Hover snaps to the nearest sample on the X axis
// across all series and renders an absolutely-positioned tooltip in
// document space.

export interface TimeSeriesPoint {
  ts: string;
  value: number;
}

export interface TimeSeriesSeries {
  name: string;
  color: string;
  data: TimeSeriesPoint[];
}

export interface TimeSeriesChartProps {
  /** Single-series shorthand. Ignored if `series` is provided. */
  data?: TimeSeriesPoint[];
  /** Multi-series. Each series renders as its own line + dot row. */
  series?: TimeSeriesSeries[];
  color?: string;
  height?: number;
  /** Override the auto y-domain. Useful when comparing across charts. */
  yDomain?: [number, number];
  yFormatter?: (n: number) => string;
  xFormatter?: (ts: string) => string;
  showArea?: boolean;
  ariaLabel?: string;
}

const DEFAULT_HEIGHT = 220;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;

function normalizeSeries(
  data: TimeSeriesPoint[] | undefined,
  series: TimeSeriesSeries[] | undefined,
  defaultColor: string,
): TimeSeriesSeries[] {
  if (series && series.length > 0) return series;
  if (!data || data.length === 0) return [];
  return [{ name: "value", color: defaultColor, data }];
}

export default function TimeSeriesChart({
  data,
  series,
  color = "var(--accent)",
  height = DEFAULT_HEIGHT,
  yDomain,
  yFormatter = (n) => String(n),
  xFormatter,
  showArea = true,
  ariaLabel = "time series chart",
}: TimeSeriesChartProps) {
  const normalized = useMemo(() => normalizeSeries(data, series, color), [data, series, color]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // All series share an X axis (sample-index based). We require the
  // longest series to be the canonical timeline; shorter series are
  // padded conceptually (we just skip null points).
  const xCount = useMemo(() => {
    let m = 0;
    for (const s of normalized) m = Math.max(m, s.data.length);
    return m;
  }, [normalized]);

  const allValues = useMemo(() => {
    const out: number[] = [];
    for (const s of normalized) for (const p of s.data) out.push(p.value);
    return out;
  }, [normalized]);

  const [yMin, yMax] = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    if (allValues.length === 0) return [0, 1];
    const lo = Math.min(...allValues);
    const hi = Math.max(...allValues);
    if (lo === hi) return [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.1;
    return [Math.max(0, lo - pad), hi + pad];
  }, [allValues, yDomain]);

  if (normalized.length === 0 || xCount === 0) {
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        No data to plot.
      </div>
    );
  }

  // Use intrinsic SVG sizing via viewBox so the chart scales with its
  // container. Width is fixed in the viewBox.
  const width = 720;
  const innerW = width - PAD_L - PAD_R;
  const innerH = height - PAD_T - PAD_B;
  const stepX = xCount > 1 ? innerW / (xCount - 1) : 0;
  const yRange = yMax - yMin || 1;

  function xAt(i: number): number {
    return PAD_L + i * stepX;
  }
  function yAt(v: number): number {
    return PAD_T + innerH - ((v - yMin) / yRange) * innerH;
  }

  // 4 grid lines + axis labels.
  const gridTicks = 4;
  const yTicks = Array.from({ length: gridTicks + 1 }, (_, i) => yMin + (yRange * i) / gridTicks);
  // X axis labels: first, middle, last for the canonical series.
  const canonical = normalized.reduce((longest, s) =>
    s.data.length > longest.data.length ? s : longest,
  );
  const xLabels: { i: number; label: string }[] = [];
  if (canonical.data.length > 0) {
    const positions = [0, Math.floor((canonical.data.length - 1) / 2), canonical.data.length - 1];
    for (const i of positions) {
      const ts = canonical.data[i]?.ts;
      if (ts == null) continue;
      xLabels.push({ i, label: xFormatter ? xFormatter(ts) : ts.slice(0, 10) });
    }
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < PAD_L || px > width - PAD_R) {
      setHoverIdx(null);
      setHoverX(null);
      return;
    }
    const i = Math.round((px - PAD_L) / stepX);
    const clamped = Math.max(0, Math.min(xCount - 1, i));
    setHoverIdx(clamped);
    setHoverX(((e.clientX - rect.left) / rect.width) * 100);
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMove}
        onMouseLeave={() => {
          setHoverIdx(null);
          setHoverX(null);
        }}
        style={{ display: "block" }}
      >
        {/* Y grid + labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={width - PAD_R}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={yAt(t) + 4}
              fontSize={10}
              fill="var(--fg-muted)"
              textAnchor="end"
            >
              {yFormatter(t)}
            </text>
          </g>
        ))}
        {/* X labels */}
        {xLabels.map((xl) => (
          <text
            key={xl.i}
            x={xAt(xl.i)}
            y={height - 6}
            fontSize={10}
            fill="var(--fg-muted)"
            textAnchor="middle"
          >
            {xl.label}
          </text>
        ))}
        {/* Series */}
        {normalized.map((s) => {
          if (s.data.length === 0) return null;
          const stroke = s.color || color;
          const path = s.data
            .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)} ${yAt(p.value).toFixed(2)}`)
            .join(" ");
          const last = s.data[s.data.length - 1];
          const areaPath = `${path} L${xAt(s.data.length - 1).toFixed(2)} ${yAt(yMin).toFixed(2)} L${xAt(0).toFixed(2)} ${yAt(yMin).toFixed(2)} Z`;
          return (
            <g key={s.name}>
              {showArea && normalized.length === 1 ? (
                <path d={areaPath} fill={stroke} fillOpacity="0.12" />
              ) : null}
              <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
              {hoverIdx !== null && hoverIdx < s.data.length ? (
                <circle
                  cx={xAt(hoverIdx)}
                  cy={yAt(s.data[hoverIdx]?.value ?? 0)}
                  r={3.5}
                  fill={stroke}
                  stroke="var(--bg-elevated)"
                  strokeWidth={1.5}
                />
              ) : null}
              {/* Last-point dot for at-a-glance current value when not hovering */}
              {hoverIdx === null && last ? (
                <circle cx={xAt(s.data.length - 1)} cy={yAt(last.value)} r={2.5} fill={stroke} />
              ) : null}
            </g>
          );
        })}
        {/* Hover guideline */}
        {hoverIdx !== null ? (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={PAD_T}
            y2={height - PAD_B}
            stroke="var(--border-strong)"
            strokeDasharray="3 3"
          />
        ) : null}
      </svg>
      {/* Tooltip */}
      {hoverIdx !== null && hoverX !== null ? (
        <div
          style={{
            position: "absolute",
            left: `${hoverX}%`,
            top: 0,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "6px 10px",
            fontSize: 12,
            boxShadow: "var(--shadow-card)",
            minWidth: 120,
          }}
        >
          <div style={{ color: "var(--fg-muted)", fontSize: 11, marginBottom: 4 }}>
            {(() => {
              const ts = canonical.data[Math.min(hoverIdx, canonical.data.length - 1)]?.ts;
              return ts ? (xFormatter ? xFormatter(ts) : ts) : "";
            })()}
          </div>
          {normalized.map((s) => {
            const p = s.data[hoverIdx];
            if (!p) return null;
            return (
              <div
                key={s.name}
                style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: 1.4 }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: s.color,
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "var(--fg-muted)" }}>{s.name}</span>
                <span style={{ marginLeft: "auto", fontWeight: 600 }}>{yFormatter(p.value)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {/* Legend (multi-series only) */}
      {normalized.length > 1 ? (
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            marginTop: 8,
            fontSize: 12,
            color: "var(--fg-muted)",
          }}
        >
          {normalized.map((s) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: s.color,
                  display: "inline-block",
                }}
              />
              {s.name}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
