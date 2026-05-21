import Link from "next/link";
import { Suspense } from "react";
import Skeleton from "../../../components/ui/Skeleton";
import { adminFetch } from "../../../lib/api/admin-client";
import type { UserSummaryDTO } from "../../../lib/api/types";

interface SearchParams {
  searchParams: Promise<{ query?: string; status?: string; cursor?: string }>;
}

export const dynamic = "force-dynamic";

// PERF-A1: keep the search form static so it renders immediately;
// stream the results table in a Suspense boundary so the heading + form
// are interactive while the backend fetch is still in flight.
export default async function UsersPage({ searchParams }: SearchParams) {
  const sp = await searchParams;

  return (
    <div>
      <div className="page-header">
        <h2>Users</h2>
      </div>
      <form className="toolbar" action="/users" method="get">
        <div style={{ flex: 1 }}>
          <label htmlFor="query">Search</label>
          <input
            id="query"
            name="query"
            placeholder="user ID, display name…"
            defaultValue={sp.query ?? ""}
          />
        </div>
        <div style={{ width: 160 }}>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Any</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="banned">banned</option>
            <option value="deleted">deleted</option>
          </select>
        </div>
        <button type="submit" className="primary">
          Search
        </button>
      </form>

      <Suspense
        // Re-suspend whenever the search params change so the table
        // skeleton replaces the previous result set instantly.
        key={`${sp.query ?? ""}|${sp.status ?? ""}|${sp.cursor ?? ""}`}
        fallback={<UsersTableSkeleton />}
      >
        <UsersTable query={sp.query} status={sp.status} cursor={sp.cursor} spForLinks={sp} />
      </Suspense>
    </div>
  );
}

function UsersTableSkeleton() {
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>User ID</th>
            <th>Display name</th>
            <th>Age</th>
            <th>Status</th>
            <th>Profile</th>
            <th>Reports</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: pure-shape skeleton
            <tr key={i}>
              <td>
                <Skeleton width={140} height={12} />
              </td>
              <td>
                <Skeleton width={120} height={12} />
              </td>
              <td>
                <Skeleton width={24} height={12} />
              </td>
              <td>
                <Skeleton width={60} height={12} />
              </td>
              <td>
                <Skeleton width={60} height={12} />
              </td>
              <td>
                <Skeleton width={20} height={12} />
              </td>
              <td>
                <Skeleton width={80} height={12} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function UsersTable({
  query,
  status,
  cursor,
  spForLinks,
}: {
  query: string | undefined;
  status: string | undefined;
  cursor: string | undefined;
  spForLinks: { query?: string; status?: string; cursor?: string };
}) {
  const res = await adminFetch<{
    users: UserSummaryDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/users", {
    query: { query, status, cursor, limit: 50 },
  });
  const data = res.ok ? res.data : null;

  if (!res.ok) {
    return (
      <div className="error">
        Search failed ({res.status} {res.error.code}).
      </div>
    );
  }
  if (data!.users.length === 0) {
    return <div className="card muted">No users match.</div>;
  }
  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Display name</th>
              <th>Age</th>
              <th>Status</th>
              <th>Profile</th>
              <th>Reports</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {data!.users.map((u) => (
              <tr key={u.userId}>
                <td>
                  <Link href={`/users/${u.userId}`}>{u.userId}</Link>
                </td>
                <td>{u.displayName ?? <span className="muted">—</span>}</td>
                <td>{u.age ?? "—"}</td>
                <td>
                  <span className={`badge ${u.status}`}>{u.status}</span>
                </td>
                <td>
                  {u.profileStatus ? (
                    <span className={`badge ${u.profileStatus}`}>{u.profileStatus}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{u.reportCount}</td>
                <td className="muted">{u.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={{
              pathname: "/users",
              query: { ...spForLinks, cursor: data.nextCursor },
            }}
          >
            Next page →
          </Link>
        </div>
      ) : null}
    </>
  );
}
