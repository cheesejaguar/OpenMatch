import DataTable, { type DataTableColumn } from "../../../components/ui/DataTable";
import EmptyState from "../../../components/ui/EmptyState";
import FilterBar from "../../../components/ui/FilterBar";
import { adminFetch } from "../../../lib/api/admin-client";
import type { GeographyBucketDTO, GeographyDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ metro?: string }>;
}

const DEFAULT_METRO = "sf-bay-area";

/**
 * Render a Botanic-styled scatter plot of metro buckets. Bone canvas,
 * moss circles, radius scaled to userCount. Hand-rolled SVG to match
 * the rest of the dashboard (zero chart deps).
 */
function ScatterPlot({ buckets }: { buckets: GeographyBucketDTO[] }) {
  if (buckets.length === 0) {
    return <div className="muted">No buckets to plot.</div>;
  }
  const lats = buckets.map((b) => b.lat);
  const lngs = buckets.map((b) => b.lng);
  const counts = buckets.map((b) => b.userCount);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);
  const latRange = latMax - latMin || 0.01;
  const lngRange = lngMax - lngMin || 0.01;
  const maxCount = Math.max(...counts, 1);

  const width = 720;
  const height = 360;
  const pad = 24;

  function x(lng: number): number {
    return pad + ((lng - lngMin) / lngRange) * (width - pad * 2);
  }
  function y(lat: number): number {
    // Invert Y — higher lat is north (top).
    return pad + (1 - (lat - latMin) / latRange) * (height - pad * 2);
  }
  function r(count: number): number {
    const min = 4;
    const max = 28;
    return min + Math.sqrt(count / maxCount) * (max - min);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Metro user-density scatter plot"
      style={{
        display: "block",
        background: "var(--bg-sunken)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Reference grid */}
      <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke="var(--border)" />
      <line x1={width / 2} x2={width / 2} y1={pad} y2={height - pad} stroke="var(--border)" />
      {buckets.map((b) => (
        <g key={b.label}>
          <circle
            cx={x(b.lng)}
            cy={y(b.lat)}
            r={r(b.userCount)}
            fill="var(--accent)"
            fillOpacity={0.28}
            stroke="var(--accent)"
            strokeWidth={1.5}
          />
          <text
            x={x(b.lng)}
            y={y(b.lat) - r(b.userCount) - 4}
            textAnchor="middle"
            fontSize={11}
            fill="var(--fg)"
          >
            {b.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function GeographyPage({ searchParams }: Params) {
  const sp = await searchParams;
  const metro = sp.metro || DEFAULT_METRO;
  const res = await adminFetch<GeographyDTO>("/api/v1/admin/geography", { query: { metro } });

  if (res.status === 404) {
    return (
      <div>
        <div className="page-header">
          <h2>Geographic insights</h2>
        </div>
        <EmptyState
          title="Geography endpoint not yet deployed"
          description="Round 2A ships /admin/geography. Once that lands this view will show neighborhood-level density for the selected metro."
          tone="warning"
        />
      </div>
    );
  }
  if (res.status !== 200) {
    return (
      <div>
        <div className="page-header">
          <h2>Geographic insights</h2>
        </div>
        <div className="error">Failed to load geography ({res.status}).</div>
      </div>
    );
  }

  const buckets = [...res.data.buckets].sort((a, b) => b.userCount - a.userCount);
  const columns: DataTableColumn<GeographyBucketDTO>[] = [
    { key: "label", label: "Neighborhood", sortable: true },
    { key: "userCount", label: "Users", align: "right", sortable: true },
    { key: "matchCount", label: "Matches", align: "right", sortable: true },
    {
      key: "lat",
      label: "Centroid",
      formatter: (_v, row) => `${row.lat.toFixed(3)}, ${row.lng.toFixed(3)}`,
    },
  ];

  // metro field can be null (no active metro). Render a friendly label
  // either way.
  const metroLabel = res.data.metro ? `${res.data.metro.name} (${res.data.metro.slug})` : metro;

  return (
    <div>
      <div className="page-header">
        <h2>Geographic insights — {metroLabel}</h2>
      </div>
      <form action="/geography" method="get" style={{ marginBottom: 16 }}>
        <FilterBar
          action={
            <button type="submit" className="primary">
              Apply
            </button>
          }
        >
          <div style={{ width: 240 }}>
            <label htmlFor="metro">Metro</label>
            <input id="metro" name="metro" defaultValue={metro} />
          </div>
        </FilterBar>
      </form>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Density scatter</h3>
        <ScatterPlot buckets={buckets} />
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Bubble size is √(userCount). A real choropleth map ships post-beta.
        </div>
      </div>

      <DataTable
        columns={columns}
        data={buckets}
        rowKey={(r) => r.label}
        initialPageSize={25}
        emptyMessage="No buckets reported for this metro."
      />
    </div>
  );
}
