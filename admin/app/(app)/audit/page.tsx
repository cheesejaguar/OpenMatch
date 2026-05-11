import Link from "next/link";
import { adminFetch } from "../../../lib/api/admin-client";
import type { AuditEventDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{
    adminUserId?: string;
    eventType?: string;
    targetEntityType?: string;
    targetEntityId?: string;
    cursor?: string;
  }>;
}

export default async function AuditPage({ searchParams }: Params) {
  const sp = await searchParams;
  const { data, status } = await adminFetch<{
    events: AuditEventDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/audit", { query: { ...sp, limit: 100 } });

  return (
    <div>
      <div className="page-header">
        <h2>Audit log</h2>
      </div>
      <form className="toolbar" action="/audit" method="get">
        <div style={{ width: 200 }}>
          <label htmlFor="adminUserId">Admin ID</label>
          <input id="adminUserId" name="adminUserId" defaultValue={sp.adminUserId ?? ""} />
        </div>
        <div style={{ width: 180 }}>
          <label htmlFor="eventType">Event</label>
          <input id="eventType" name="eventType" defaultValue={sp.eventType ?? ""} />
        </div>
        <div style={{ width: 160 }}>
          <label htmlFor="targetEntityType">Target type</label>
          <input
            id="targetEntityType"
            name="targetEntityType"
            defaultValue={sp.targetEntityType ?? ""}
          />
        </div>
        <div style={{ width: 200 }}>
          <label htmlFor="targetEntityId">Target ID</label>
          <input id="targetEntityId" name="targetEntityId" defaultValue={sp.targetEntityId ?? ""} />
        </div>
        <button type="submit" className="primary">
          Filter
        </button>
      </form>

      {status === 403 ? (
        <div className="error">You don&apos;t have permission to view the audit log.</div>
      ) : status !== 200 ? (
        <div className="error">Failed to load ({status}).</div>
      ) : data.events.length === 0 ? (
        <div className="card muted">No audit events match.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Roles</th>
                <th>Event</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{e.createdAt.slice(0, 19).replace("T", " ")}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                    {e.adminUserId.slice(0, 10)}…
                  </td>
                  <td className="muted">{e.adminRoleSnapshot}</td>
                  <td>{e.eventType}</td>
                  <td>
                    {e.targetEntityType && e.targetEntityId ? (
                      <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                        {e.targetEntityType}/{e.targetEntityId.slice(0, 10)}…
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{e.accessReason ?? <span className="muted">—</span>}</td>
                  <td>
                    {e.reportId ? (
                      <Link href={`/reports/${e.reportId}`}>{e.reportId.slice(0, 8)}…</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link href={{ pathname: "/audit", query: { ...sp, cursor: data.nextCursor } }}>
            Next page →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
