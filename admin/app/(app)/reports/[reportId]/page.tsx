import Link from "next/link";
import SensitiveBanner from "../../../../components/access/SensitiveBanner";
import ResolveForm from "../../../../components/report/ResolveForm";
import { adminFetch } from "../../../../lib/api/admin-client";
import type { ReportDetailDTO } from "../../../../lib/api/types";
import { readSession } from "../../../../lib/auth/session";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ reportId: string }>;
}

export default async function ReportDetailPage({ params }: Params) {
  const { reportId } = await params;
  const session = (await readSession())!;
  const { data, status } = await adminFetch<ReportDetailDTO>(`/api/v1/admin/reports/${reportId}`);
  if (status === 404) {
    return (
      <div>
        <div className="page-header">
          <h2>Report not found</h2>
        </div>
      </div>
    );
  }
  if (status !== 200) {
    return (
      <div>
        <div className="page-header">
          <h2>Report</h2>
        </div>
        <div className="error">Failed to load ({status}).</div>
      </div>
    );
  }

  const isOpen = data.status === "open" || data.status === "reviewing";

  return (
    <div>
      <SensitiveBanner />
      <div className="page-header">
        <h2>
          Report {data.id.slice(0, 10)}…{" "}
          <span className={`badge ${data.status}`}>{data.status}</span>
        </h2>
        <Link href="/reports">← All reports</Link>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Report</h3>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
            <dt className="muted">Reason</dt>
            <dd style={{ margin: 0 }}>{data.reason}</dd>
            <dt className="muted">Details</dt>
            <dd style={{ margin: 0 }}>{data.details || <span className="muted">—</span>}</dd>
            <dt className="muted">Created</dt>
            <dd style={{ margin: 0 }}>{data.createdAt.slice(0, 16)}</dd>
            <dt className="muted">Resolution</dt>
            <dd style={{ margin: 0 }}>{data.resolution ?? "—"}</dd>
            <dt className="muted">Resolved at</dt>
            <dd style={{ margin: 0 }}>{data.resolvedAt?.slice(0, 16) ?? "—"}</dd>
          </dl>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Parties</h3>
          <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Reporter
            </div>
            <Link href={`/users/${data.reporter.userId}`}>
              {data.reporter.displayName ?? data.reporter.userId}
            </Link>{" "}
            <span className={`badge ${data.reporter.status}`}>{data.reporter.status}</span>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Reported
            </div>
            <Link href={`/users/${data.reported.userId}`}>
              {data.reported.displayName ?? data.reported.userId}
            </Link>{" "}
            <span className={`badge ${data.reported.status}`}>{data.reported.status}</span>{" "}
            <span className="muted">· {data.reported.reportCount} prior reports</span>
          </div>
        </div>
      </div>

      {data.reportedMessage ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Reported message + context</h3>
          {data.messageContext.map((m) => {
            const isReported = m.id === data.reportedMessageId;
            return (
              <div key={m.id} className={`message ${isReported ? "reported" : ""}`}>
                <div className="meta">
                  {m.senderUserId} · {m.createdAt.slice(0, 16)}{" "}
                  {isReported ? <strong>· REPORTED</strong> : null}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Prior reports on this user</h3>
        {data.priorReports.length === 0 ? (
          <div className="muted">None.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Resolution</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.priorReports.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/reports/${p.id}`}>{p.id.slice(0, 10)}…</Link>
                  </td>
                  <td>{p.reason}</td>
                  <td>
                    <span className={`badge ${p.status}`}>{p.status}</span>
                  </td>
                  <td>{p.resolution ?? "—"}</td>
                  <td className="muted">{p.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.moderationActions.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Moderation actions</h3>
          {data.moderationActions.map((m) => (
            <div
              key={m.id}
              style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}
            >
              <div className="muted" style={{ fontSize: 12 }}>
                {m.createdAt.slice(0, 16)} · {m.createdByAdminUserId}
              </div>
              <div>
                <strong>{m.actionType}</strong> · {m.reasonCode}
              </div>
              {m.internalNote ? (
                <div style={{ whiteSpace: "pre-wrap" }}>{m.internalNote}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {isOpen ? (
        <div style={{ marginTop: 16 }}>
          <ResolveForm reportId={data.id} permissions={session.permissions} />
        </div>
      ) : null}
    </div>
  );
}
