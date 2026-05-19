import Link from "next/link";
import DataTable, { type DataTableColumn } from "../../../components/ui/DataTable";
import EmptyState from "../../../components/ui/EmptyState";
import FilterBar from "../../../components/ui/FilterBar";
import TimeSeriesChart, { type TimeSeriesSeries } from "../../../components/ui/TimeSeriesChart";
import { adminFetch } from "../../../lib/api/admin-client";
import {
  type FunnelDTO,
  type FunnelStepDTO,
  type InviteListDTO,
  type RetentionDTO,
  type TimeSeriesDTO,
  timeseriesToPoints,
} from "../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{
    tab?: string;
    from?: string;
    to?: string;
    cohort?: string;
  }>;
}

const TABS = [
  { key: "funnel", label: "Funnel" },
  { key: "retention", label: "Retention" },
  { key: "engagement", label: "Engagement" },
] as const;

// Aurora Dawn palette — 6 distinct hues for chart segments. Hex literals
// (not CSS vars) because Recharts consumes raw color strings, not computed
// styles. Light-mode values; dark-mode would need a theme observer.
const RETENTION_COLORS = ["#5b2b6e", "#e63d7c", "#ffb347", "#a6b4ff", "#b8a8c9", "#d43a3a"];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function endpointMissing(status: number): boolean {
  return status === 404;
}

export default async function AnalyticsPage({ searchParams }: Params) {
  const sp = await searchParams;
  const activeTab = (TABS.find((t) => t.key === sp.tab)?.key ?? "funnel") as
    | "funnel"
    | "retention"
    | "engagement";
  const from = sp.from ?? isoDaysAgo(14);
  const to = sp.to ?? isoDaysAgo(0);
  const cohort = sp.cohort ?? "";

  // Cohort dropdown — derived from invite list (R1A, already shipped).
  const invitesRes = await adminFetch<InviteListDTO>("/api/v1/admin/invites", {
    query: { limit: 200 },
  });
  const cohortSet = new Set<string>();
  if (invitesRes.ok) {
    for (const inv of invitesRes.data.items) cohortSet.add(inv.cohortLabel);
  }
  const cohorts = Array.from(cohortSet).sort();

  return (
    <div>
      <div className="page-header">
        <h2>Analytics</h2>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={{ pathname: "/analytics", query: { ...sp, tab: t.key } }}
            className={activeTab === t.key ? "active" : ""}
            role="tab"
            aria-selected={activeTab === t.key}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <form className="toolbar" action="/analytics" method="get" style={{ marginBottom: 16 }}>
        <input type="hidden" name="tab" value={activeTab} />
        <FilterBar
          action={
            <button type="submit" className="primary">
              Apply
            </button>
          }
        >
          <div style={{ width: 160 }}>
            <label htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={from} />
          </div>
          <div style={{ width: 160 }}>
            <label htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={to} />
          </div>
          <div style={{ width: 200 }}>
            <label htmlFor="cohort">Cohort</label>
            <select id="cohort" name="cohort" defaultValue={cohort}>
              <option value="">All cohorts</option>
              {cohorts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </FilterBar>
      </form>

      {activeTab === "funnel" ? (
        <FunnelTab from={from} to={to} cohort={cohort || undefined} />
      ) : activeTab === "retention" ? (
        <RetentionTab from={from} to={to} cohort={cohort || undefined} />
      ) : (
        <EngagementTab from={from} to={to} cohort={cohort || undefined} />
      )}
    </div>
  );
}

async function FunnelTab({ from, to, cohort }: { from: string; to: string; cohort?: string }) {
  const res = await adminFetch<FunnelDTO>("/api/v1/admin/analytics/funnel", {
    query: { from, to, cohort },
  });
  if (endpointMissing(res.status)) {
    return (
      <EmptyState
        title="Funnel endpoint not yet deployed"
        description="Round 2A ships /admin/analytics/funnel. Once that lands this view will render conversion-per-step."
        tone="warning"
      />
    );
  }
  if (!res.ok) {
    return (
      <div className="error">
        Failed to load funnel ({res.status} {res.error.code}).
      </div>
    );
  }
  const steps = res.data.steps;
  const max = steps.length > 0 ? Math.max(...steps.map((s) => s.count)) : 1;
  const columns: DataTableColumn<FunnelStepDTO>[] = [
    { key: "name", label: "Step" },
    { key: "count", label: "Users", align: "right" },
    {
      key: "conversionFromPrior",
      label: "From prior",
      align: "right",
      formatter: (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`),
    },
  ];
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Conversion funnel</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.map((s) => {
            const pct = max > 0 ? (s.count / max) * 100 : 0;
            return (
              <div key={s.name}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ color: "var(--fg)" }}>{s.name}</span>
                  <span style={{ color: "var(--fg-muted)" }}>
                    {s.count.toLocaleString()}
                    {s.conversionFromPrior != null
                      ? ` · ${(s.conversionFromPrior * 100).toFixed(1)}% from prior`
                      : ""}
                  </span>
                </div>
                <div
                  style={{
                    background: "var(--bg-sunken)",
                    borderRadius: 999,
                    height: 14,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <DataTable
          columns={columns}
          data={steps}
          rowKey={(r) => r.name}
          initialPageSize={25}
          emptyMessage="Funnel has no steps in this range."
        />
      </div>
    </>
  );
}

async function RetentionTab({ from, to, cohort }: { from: string; to: string; cohort?: string }) {
  const res = await adminFetch<RetentionDTO>("/api/v1/admin/analytics/retention", {
    query: { from, to, cohort },
  });
  if (endpointMissing(res.status)) {
    return (
      <EmptyState
        title="Retention endpoint not yet deployed"
        description="Round 2A ships /admin/analytics/retention. Once that lands D1/D7/D30 cohort curves render here."
        tone="warning"
      />
    );
  }
  if (!res.ok) {
    return (
      <div className="error">
        Failed to load retention ({res.status} {res.error.code}).
      </div>
    );
  }
  const cohorts = res.data.cohorts;
  if (cohorts.length === 0) {
    return (
      <EmptyState
        title="No cohorts in range"
        description="Widen the date range or pick a different cohort label."
      />
    );
  }
  // R2A retention shape: each cohort row has d1/d7/d30 fractions.
  // Synthesize a D0 = 1.0 anchor so the curve starts at the cohort
  // size, and filter out future windows (null).
  const series: TimeSeriesSeries[] = cohorts.map((c, i) => {
    const pts: { ts: string; value: number }[] = [{ ts: "D0", value: 1 }];
    if (c.d1 != null) pts.push({ ts: "D1", value: c.d1 });
    if (c.d7 != null) pts.push({ ts: "D7", value: c.d7 });
    if (c.d30 != null) pts.push({ ts: "D30", value: c.d30 });
    return {
      name: `${c.signupDate} (n=${c.cohortSize})`,
      color: RETENTION_COLORS[i % RETENTION_COLORS.length] ?? "var(--accent)",
      data: pts,
    };
  });
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Cohort retention</h3>
      <TimeSeriesChart
        series={series}
        height={300}
        showArea={false}
        yDomain={[0, 1]}
        yFormatter={(n) => `${Math.round(n * 100)}%`}
        xFormatter={(ts) => ts}
        ariaLabel="Cohort retention curves"
      />
    </div>
  );
}

async function EngagementTab({ from, to, cohort }: { from: string; to: string; cohort?: string }) {
  const fetchSeries = (metric: string) =>
    adminFetch<TimeSeriesDTO>("/api/v1/admin/analytics/timeseries", {
      query: { metric, from, to, cohort, granularity: "day" },
    });
  const [signupsRes, matchesRes, messagesRes] = await Promise.all([
    fetchSeries("signups"),
    fetchSeries("matches"),
    fetchSeries("messages"),
  ]);
  const anyMissing =
    endpointMissing(signupsRes.status) ||
    endpointMissing(matchesRes.status) ||
    endpointMissing(messagesRes.status);
  if (anyMissing) {
    return (
      <EmptyState
        title="Engagement timeseries not yet deployed"
        description="Round 2A ships /admin/analytics/timeseries for signups/matches/messages. Charts will populate once merged."
        tone="warning"
      />
    );
  }
  const charts = [
    { title: "Signups per day", res: signupsRes, color: "var(--accent)" },
    { title: "Matches per day", res: matchesRes, color: "var(--accent-strong)" },
    { title: "Messages per day", res: messagesRes, color: "var(--warning)" },
  ] as const;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {charts.map(({ title, res, color }) => (
        <div key={title} className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>{title}</h3>
          {!res.ok ? (
            <div className="error">
              Failed to load ({res.status} {res.error.code}).
            </div>
          ) : (
            <TimeSeriesChart
              data={timeseriesToPoints(res.data)}
              color={color}
              xFormatter={(ts) => ts.slice(5, 10)}
              ariaLabel={title}
            />
          )}
        </div>
      ))}
    </div>
  );
}
