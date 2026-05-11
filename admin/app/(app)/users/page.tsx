import Link from "next/link";
import { adminFetch } from "../../../lib/api/admin-client";
import type { UserSummaryDTO } from "../../../lib/api/types";

interface SearchParams {
  searchParams: Promise<{ query?: string; status?: string; cursor?: string }>;
}

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: SearchParams) {
  const sp = await searchParams;
  const { data, status } = await adminFetch<{
    users: UserSummaryDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/users", {
    query: { query: sp.query, status: sp.status, cursor: sp.cursor, limit: 50 },
  });

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

      {status !== 200 ? (
        <div className="error">Search failed ({status}).</div>
      ) : data.users.length === 0 ? (
        <div className="card muted">No users match.</div>
      ) : (
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
              {data.users.map((u) => (
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
      )}

      {data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={{
              pathname: "/users",
              query: { ...sp, cursor: data.nextCursor },
            }}
          >
            Next page →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
