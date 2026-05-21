import type { Metadata } from "next";

import {
  type DailyUptimePoint,
  fetchPublicStatus,
  type IncidentSummary,
  type ServiceSummary,
  type StatusHeadline,
} from "../../lib/api/status-client";
import { getMessages } from "../../lib/i18n";

// Public OpenMatch status page. Visitors check this URL when they
// want to know whether the platform is up — it's intentionally
// unauthenticated (middleware allowlist + no auth-bearing fetches)
// and reads from the public `/api/v1/status/public` aggregation.
//
// Page contract (per the feature spec):
//   - Headline reflects synthetic pass-rate over the last 60 minutes
//     AND any currently-active incident, picking the more severe.
//   - Per-service tiles (backend / admin / push / realtime) with
//     90-day uptime numbers.
//   - 90-day uptime chart, one row per service.
//   - Recent incidents list: active + last 7 days resolved.

export const metadata: Metadata = {
  title: "OpenMatch status",
  description: "Current operating status of OpenMatch services.",
  robots: { index: true, follow: true },
};

// Public page — skip the no-cache header that the admin shell applies
// to every other route. We still revalidate the underlying data every
// 15 s via the status-client fetch options.
export const dynamic = "force-dynamic";

const HEADLINE_VARIANT: Record<StatusHeadline, { dot: string; label: string }> = {
  normal: { dot: "var(--success, #2f8a5c)", label: "All systems normal" },
  degraded: { dot: "var(--warning, #d29d3a)", label: "Degraded performance" },
  incident: { dot: "var(--danger, #c14a4a)", label: "Active incident" },
  unknown: { dot: "var(--muted, #888)", label: "Status unknown" },
};

const SEVERITY_BADGE: Record<IncidentSummary["severity"], string> = {
  none: "info",
  minor: "warning",
  major: "danger",
  critical: "danger",
};

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function UptimeRow({ service, points }: { service: ServiceSummary; points: DailyUptimePoint[] }) {
  // 90 cells, one per UTC day. Color buckets mirror the headline
  // thresholds (≥95 / 80-95 / <80) so the row reads like a heat-map.
  return (
    <tr>
      <th
        scope="row"
        style={{
          textAlign: "left",
          fontWeight: 600,
          paddingRight: 12,
          whiteSpace: "nowrap",
        }}
      >
        {service.label}
      </th>
      <td style={{ width: "100%" }}>
        <div
          role="img"
          aria-label={`${service.label}: ${formatPct(service.uptime90d)} uptime over 90 days`}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
            gap: 1,
            height: 28,
          }}
        >
          {points.map((p) => {
            const color =
              p.passRate === null
                ? "var(--muted, #ccc)"
                : p.passRate >= 0.95
                  ? "var(--success, #2f8a5c)"
                  : p.passRate >= 0.8
                    ? "var(--warning, #d29d3a)"
                    : "var(--danger, #c14a4a)";
            return (
              <span
                key={p.day}
                title={`${p.day} · ${formatPct(p.passRate)} (${p.passed}/${p.total})`}
                style={{
                  backgroundColor: color,
                  borderRadius: 2,
                  display: "block",
                  height: "100%",
                }}
              />
            );
          })}
        </div>
      </td>
      <td
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          paddingLeft: 12,
          whiteSpace: "nowrap",
        }}
      >
        {formatPct(service.uptime90d)}
      </td>
    </tr>
  );
}

function IncidentCard({ inc }: { inc: IncidentSummary }) {
  const sev = SEVERITY_BADGE[inc.severity];
  return (
    <article
      style={{
        border: "1px solid var(--border, #e6e6e6)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>{inc.title}</h3>
        <span className={`badge ${sev}`}>{inc.severity}</span>
        <span style={{ color: "var(--muted, #888)", fontSize: 13 }}>{inc.service}</span>
        <span style={{ marginLeft: "auto", color: "var(--muted, #888)", fontSize: 13 }}>
          Updated{" "}
          <time dateTime={inc.updatedAt}>
            {new Date(inc.updatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </span>
      </header>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {[...inc.updates].reverse().map((u) => (
          <li
            key={u.id}
            style={{
              marginBottom: 8,
              paddingLeft: 12,
              borderLeft: "2px solid var(--border, #e6e6e6)",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {u.status} · {u.title}
            </div>
            <div style={{ fontSize: 14, color: "var(--ink, #333)", whiteSpace: "pre-wrap" }}>
              {u.body}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>
              <time dateTime={u.postedAt}>
                {new Date(u.postedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function ServiceTile({ service }: { service: ServiceSummary }) {
  const headline = HEADLINE_VARIANT[service.status];
  return (
    <div
      style={{
        border: "1px solid var(--border, #e6e6e6)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 13, color: "var(--muted, #888)", marginBottom: 4 }}>
        {service.label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: headline.dot,
          }}
        />
        <span style={{ fontWeight: 600 }}>{headline.label}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted, #888)", marginTop: 6 }}>
        90d · {formatPct(service.uptime90d)} · 24h · {formatPct(service.uptime24h)}
      </div>
    </div>
  );
}

export default async function PublicStatusPage() {
  const [data, t] = await Promise.all([fetchPublicStatus(), getMessages()]);

  if (!data) {
    // Backend unreachable. We still want to render *something* helpful
    // — show an "unknown" headline rather than crash, and link to the
    // GitHub issues page where users can report platform problems.
    return (
      <main
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "32px 24px",
          fontFamily: "var(--font-geist), system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>{t("status.page_title")}</h1>
        <p style={{ color: "var(--muted, #888)", marginBottom: 24 }}>
          {t("status.headline.unknown")}
        </p>
        <p>
          We couldn't reach the status feed. If you're seeing platform problems, please open an{" "}
          <a href="https://github.com/cheesejaguar/openmatch/issues">issue on GitHub</a>.
        </p>
      </main>
    );
  }

  const headline = HEADLINE_VARIANT[data.headline];
  const headlineKey: keyof typeof HEADLINE_VARIANT = data.headline;

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "32px 24px",
        fontFamily: "var(--font-geist), system-ui, sans-serif",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, marginBottom: 6 }}>{t("status.page_title")}</h1>
        <p style={{ color: "var(--muted, #888)", margin: 0 }}>{t("status.page_subtitle")}</p>
      </header>

      <section
        aria-labelledby="status-headline"
        style={{
          padding: 20,
          borderRadius: 10,
          backgroundColor: "var(--surface-elevated, #fff)",
          border: "1px solid var(--border, #e6e6e6)",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: headline.dot,
            flexShrink: 0,
          }}
        />
        <div>
          <h2 id="status-headline" style={{ margin: 0, fontSize: 22 }}>
            {t(`status.headline.${headlineKey}`)}
          </h2>
          {data.headlineMessage && data.headlineMessage !== headline.label ? (
            <p style={{ margin: "4px 0 0", color: "var(--muted, #888)" }}>{data.headlineMessage}</p>
          ) : null}
        </div>
        <span
          style={{
            marginLeft: "auto",
            color: "var(--muted, #888)",
            fontSize: 13,
          }}
        >
          <time dateTime={data.generatedAt}>
            Checked{" "}
            {new Date(data.generatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </span>
      </section>

      <section aria-labelledby="services-h" style={{ marginBottom: 32 }}>
        <h2 id="services-h" style={{ fontSize: 18, marginBottom: 12 }}>
          Services
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {data.services.map((svc) => (
            <ServiceTile key={svc.key} service={svc} />
          ))}
        </div>
      </section>

      <section aria-labelledby="uptime-h" style={{ marginBottom: 32 }}>
        <h2 id="uptime-h" style={{ fontSize: 18, marginBottom: 12 }}>
          {t("status.uptime.90_day")}
        </h2>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <caption className="sr-only">
            90-day uptime per service, one cell per UTC day. Green = ≥95%, amber = 80–95%, red =
            below 80%.
          </caption>
          <tbody>
            {data.services.map((svc) => (
              <UptimeRow key={svc.key} service={svc} points={data.uptime90d} />
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="incidents-h">
        <h2 id="incidents-h" style={{ fontSize: 18, marginBottom: 12 }}>
          {t("status.incidents.title")}
        </h2>
        {data.activeIncidents.length === 0 && data.recentResolved.length === 0 ? (
          <p style={{ color: "var(--muted, #888)" }}>{t("status.incidents.none")}</p>
        ) : null}
        {data.activeIncidents.length > 0 ? (
          <>
            <h3 style={{ fontSize: 14, color: "var(--muted, #888)", margin: "12px 0 8px" }}>
              {t("status.incidents.active")}
            </h3>
            {data.activeIncidents.map((inc) => (
              <IncidentCard key={inc.incidentKey} inc={inc} />
            ))}
          </>
        ) : null}
        {data.recentResolved.length > 0 ? (
          <>
            <h3 style={{ fontSize: 14, color: "var(--muted, #888)", margin: "12px 0 8px" }}>
              {t("status.incidents.resolved")}
            </h3>
            {data.recentResolved.map((inc) => (
              <IncidentCard key={inc.incidentKey} inc={inc} />
            ))}
          </>
        ) : null}
      </section>

      <footer
        style={{
          marginTop: 48,
          paddingTop: 16,
          borderTop: "1px solid var(--border, #e6e6e6)",
          color: "var(--muted, #888)",
          fontSize: 13,
        }}
      >
        <p>
          OpenMatch is open-source.{" "}
          <a href="https://github.com/cheesejaguar/openmatch">Browse the code on GitHub</a>.
        </p>
      </footer>
    </main>
  );
}

// Helper kept type-narrow so the `t(`status.headline.${...}`)` lookup
// is type-safe.
type _AssertHeadlineKey = keyof typeof HEADLINE_VARIANT extends StatusHeadline ? true : never;
const _check: _AssertHeadlineKey = true;

export { _check as _typecheck };
