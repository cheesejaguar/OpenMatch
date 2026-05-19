import FlagToggle from "../../../components/flags/FlagToggle";
import NewFlagModal from "../../../components/flags/NewFlagModal";
import { adminFetch } from "../../../lib/api/admin-client";
import type { FeatureFlagListDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

export default async function FlagsPage() {
  const res = await adminFetch<FeatureFlagListDTO>("/api/v1/admin/flags");

  return (
    <div>
      <div className="page-header">
        <h2>Feature flags</h2>
        <NewFlagModal />
      </div>

      {!res.ok ? (
        <div className="error">
          Failed to load flags ({res.status} {res.error.code}).
        </div>
      ) : res.data.items.length === 0 ? (
        <div className="card muted">No flags defined yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Description</th>
                <th>State</th>
                <th>Last updated</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((f) => (
                <tr key={f.id}>
                  <td>
                    <code style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{f.key}</code>
                  </td>
                  <td style={{ color: "var(--fg-muted)" }}>{f.description}</td>
                  <td>
                    <FlagToggle flagKey={f.key} initialEnabled={f.enabled} />
                  </td>
                  <td className="muted">{f.updatedAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                    {f.updatedByAdminUserId ? f.updatedByAdminUserId.slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
