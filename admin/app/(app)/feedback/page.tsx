import Link from "next/link";
import Badge from "../../../components/ui/Badge";
import { adminFetch } from "../../../lib/api/admin-client";
import type { FeedbackListDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}

export default async function FeedbackPage({ searchParams }: Params) {
  const sp = await searchParams;
  const status = sp.status && ["open", "resolved", "all"].includes(sp.status) ? sp.status : "open";
  const res = await adminFetch<FeedbackListDTO>("/api/v1/admin/feedback", {
    query: { status, cursor: sp.cursor, limit: 50 },
  });
  const data = res.ok ? res.data : null;

  return (
    <div>
      <div className="page-header">
        <h2>Beta feedback</h2>
      </div>
      <div className="toolbar">
        {["open", "resolved", "all"].map((s) => (
          <Link
            key={s}
            href={{ pathname: "/feedback", query: { status: s } }}
            className={`badge ${status === s ? "active" : ""}`}
            style={{ padding: "4px 12px" }}
          >
            {s}
          </Link>
        ))}
      </div>

      {!res.ok ? (
        <div className="error">
          Failed to load ({res.status} {res.error.code}).
        </div>
      ) : data!.items.length === 0 ? (
        <div className="card muted">No feedback in this view.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Body</th>
                <th>Device</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data!.items.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Badge>{f.category}</Badge>
                  </td>
                  <td style={{ maxWidth: 420 }}>{f.body}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {[f.deviceModel, f.osVersion, f.appVersion].filter(Boolean).join(" · ")}
                  </td>
                  <td className="muted">{f.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    {f.resolvedAt ? (
                      <Badge variant="success">resolved</Badge>
                    ) : (
                      <Badge variant="warning">open</Badge>
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
          <Link href={{ pathname: "/feedback", query: { ...sp, cursor: data.nextCursor } }}>
            Next page →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
