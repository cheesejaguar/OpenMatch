import Link from "next/link";
import { Suspense } from "react";
import VerificationActions from "../../../../components/moderation/VerificationActions";
import Skeleton from "../../../../components/ui/Skeleton";
import { adminFetch } from "../../../../lib/api/admin-client";
import type { VerificationRequestListDTO } from "../../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}

export default async function VerificationQueuePage({ searchParams }: Params) {
  const sp = await searchParams;
  const status = sp.status ?? "pending";

  return (
    <div>
      <div className="page-header">
        <h2>Verification queue</h2>
      </div>

      <div className="toolbar">
        {["pending", "approved", "rejected", "expired", "all"].map((q) => (
          <Link
            key={q}
            href={{ pathname: "/moderation/verification", query: { status: q } }}
            className={`badge ${status === q ? "active" : ""}`}
            style={{ padding: "4px 12px" }}
          >
            {q}
          </Link>
        ))}
      </div>

      <Suspense key={`${status}|${sp.cursor ?? ""}`} fallback={<TableSkeleton />}>
        <RequestTable status={status} cursor={sp.cursor} sp={sp} />
      </Suspense>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="card">
      <Skeleton height={200} />
    </div>
  );
}

async function RequestTable({
  status,
  cursor,
  sp,
}: {
  status: string;
  cursor: string | undefined;
  sp: Record<string, string | undefined>;
}) {
  const res = await adminFetch<VerificationRequestListDTO>("/api/v1/admin/verification", {
    query: { status, cursor, limit: 50 },
  });
  if (!res.ok) {
    return (
      <div className="error">
        Failed to load ({res.status} {res.error.code}).
      </div>
    );
  }
  const data = res.data;
  if (data.requests.length === 0) {
    return <div className="card muted">No requests in this view.</div>;
  }
  return (
    <>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Submitted</th>
              <th>User</th>
              <th>Kind</th>
              <th>Challenge</th>
              <th>Image</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.requests.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  <Link href={`/users/${r.userId}`}>
                    <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      {r.userId.slice(0, 10)}…
                    </code>
                  </Link>
                </td>
                <td>{r.kind}</td>
                <td style={{ maxWidth: 280 }}>{r.challengePrompt}</td>
                <td>
                  {r.imageStorageKey ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      uploaded
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                </td>
                <td>
                  {r.status === "pending" ? (
                    <VerificationActions requestId={r.id} />
                  ) : (
                    <span className="muted">
                      {r.reviewedAt
                        ? `${r.status} ${new Date(r.reviewedAt).toLocaleDateString()}`
                        : r.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={{
              pathname: "/moderation/verification",
              query: { ...sp, cursor: data.nextCursor },
            }}
          >
            Next page →
          </Link>
        </div>
      ) : null}
    </>
  );
}
