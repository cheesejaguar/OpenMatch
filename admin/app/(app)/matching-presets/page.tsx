import MatchingPresetEditor from "../../../components/matching-presets/MatchingPresetEditor";
import NewPresetModal from "../../../components/matching-presets/NewPresetModal";
import PresetToggle from "../../../components/matching-presets/PresetToggle";
import { adminFetch } from "../../../lib/api/admin-client";
import type { MatchingPresetListDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

export default async function MatchingPresetsPage() {
  const res = await adminFetch<MatchingPresetListDTO>("/api/v1/admin/matching-presets");

  return (
    <div>
      <div className="page-header">
        <h2>Matching presets</h2>
        <NewPresetModal />
      </div>
      <p style={{ color: "var(--fg-muted)", maxWidth: 680, marginTop: -4 }}>
        Presets are the discovery styles users can pick from. Each pins a ranking strategy and a set
        of weight overrides; weights are normalized to sum to 1 when the deck is built. Exactly one
        preset is the default for users who have not chosen.
      </p>

      {!res.ok ? (
        <div className="error">
          Failed to load presets ({res.status} {res.error.code}).
        </div>
      ) : res.data.items.length === 0 ? (
        <div className="card muted">No presets defined yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Strategy</th>
                <th>Default</th>
                <th>Enabled</th>
                <th>Last updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <code style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{p.key}</code>
                  </td>
                  <td>{p.label}</td>
                  <td className="muted" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                    {p.strategyId}
                  </td>
                  <td>{p.isDefault ? <span className="success">default</span> : "—"}</td>
                  <td>
                    <PresetToggle presetKey={p.key} initialEnabled={p.enabled} />
                  </td>
                  <td className="muted">{p.updatedAt.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    <MatchingPresetEditor preset={p} />
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
