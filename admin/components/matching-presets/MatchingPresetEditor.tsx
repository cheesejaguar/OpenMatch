"use client";

import { useMemo, useState, useTransition } from "react";
import type { MatchingPresetDTO } from "../../lib/api/types";
import { STRATEGY_OPTIONS, WEIGHT_KEYS } from "../../lib/matching/weight-keys";
import { updatePreset } from "../../server/actions/matching-presets";

// "Edit" affordance per preset row. Opens a modal pre-filled from the DTO and
// PATCHes label / description / strategy / weights / default. Weights are
// per-key number inputs; the live sum is shown for context, but the backend
// normalizes to 1 at resolve time so the admin need not make it exact.
export default function MatchingPresetEditor({ preset }: { preset: MatchingPresetDTO }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(preset.label);
  const [description, setDescription] = useState(preset.description);
  const [strategyId, setStrategyId] = useState(preset.strategyId);
  const [isDefault, setIsDefault] = useState(preset.isDefault);
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const w: Record<string, number> = {};
    for (const k of WEIGHT_KEYS) w[k] = preset.weights?.[k] ?? 0;
    return w;
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sum = useMemo(
    () => Object.values(weights).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
    [weights],
  );

  function reset() {
    setOpen(false);
    setError(null);
    setLabel(preset.label);
    setDescription(preset.description);
    setStrategyId(preset.strategyId);
    setIsDefault(preset.isDefault);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Only send weights that are > 0 so the stored overlay stays sparse.
    const overlay: Record<string, number> = {};
    for (const k of WEIGHT_KEYS) if (weights[k] > 0) overlay[k] = weights[k];
    startTransition(async () => {
      const res = await updatePreset({
        key: preset.key,
        label,
        description,
        strategyId,
        weights: overlay,
        isDefault,
      });
      if (!res.ok) {
        setError(res.error ?? `Server returned ${res.status}`);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Edit
      </button>
      {open ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`edit-preset-${preset.key}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) reset();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset();
          }}
        >
          <div className="modal">
            <h3 id={`edit-preset-${preset.key}`}>
              Edit preset <code style={{ fontFamily: "var(--mono)" }}>{preset.key}</code>
            </h3>
            <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
              <div>
                <label htmlFor={`label-${preset.key}`}>Label</label>
                <input
                  id={`label-${preset.key}`}
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`desc-${preset.key}`}>Description</label>
                <textarea
                  id={`desc-${preset.key}`}
                  required
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`strategy-${preset.key}`}>Strategy</label>
                <select
                  id={`strategy-${preset.key}`}
                  value={strategyId}
                  onChange={(e) => setStrategyId(e.target.value)}
                >
                  {STRATEGY_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset
                style={{ display: "grid", gap: 6, border: "1px solid var(--border)", padding: 10 }}
              >
                <legend style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                  Weight overrides — normalized to sum 1 at runtime (current sum {sum.toFixed(2)})
                </legend>
                {WEIGHT_KEYS.map((k) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label
                      htmlFor={`w-${preset.key}-${k}`}
                      style={{ flex: 1, margin: 0, fontSize: 13 }}
                    >
                      {k}
                    </label>
                    <input
                      id={`w-${preset.key}-${k}`}
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={weights[k]}
                      onChange={(e) =>
                        setWeights((prev) => ({ ...prev, [k]: Number(e.target.value) }))
                      }
                      style={{ width: 90 }}
                    />
                  </div>
                ))}
              </fieldset>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  id={`default-${preset.key}`}
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  style={{ width: "auto" }}
                />
                <label htmlFor={`default-${preset.key}`} style={{ margin: 0 }}>
                  Default preset (applied when a user has not chosen one)
                </label>
              </div>
              {error ? <div className="error">{error}</div> : null}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={reset}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={pending}>
                  {pending ? "Saving…" : "Save preset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
