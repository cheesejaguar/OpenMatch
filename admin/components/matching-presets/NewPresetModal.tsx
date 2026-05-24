"use client";

import { useMemo, useState, useTransition } from "react";
import { STRATEGY_OPTIONS, WEIGHT_KEYS } from "../../lib/matching/weight-keys";
import { createPreset } from "../../server/actions/matching-presets";

// Create a new matching preset. Weight inputs default to 0 (inherit the base
// config); any non-zero value becomes part of the stored overlay. The backend
// normalizes weights at resolve time.
export default function NewPresetModal() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [strategyId, setStrategyId] = useState(STRATEGY_OPTIONS[0].id as string);
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0])),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sum = useMemo(
    () => Object.values(weights).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
    [weights],
  );

  function close() {
    setOpen(false);
    setKey("");
    setLabel("");
    setDescription("");
    setStrategyId(STRATEGY_OPTIONS[0].id);
    setEnabled(true);
    setIsDefault(false);
    setWeights(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0])));
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const overlay: Record<string, number> = {};
    for (const k of WEIGHT_KEYS) if (weights[k] > 0) overlay[k] = weights[k];
    startTransition(async () => {
      const res = await createPreset({
        key,
        label,
        description,
        strategyId,
        weights: overlay,
        enabled,
        isDefault,
      });
      if (!res.ok) {
        setError(res.error ?? `Server returned ${res.status}`);
        return;
      }
      close();
    });
  }

  return (
    <>
      <button type="button" className="primary" onClick={() => setOpen(true)}>
        New preset
      </button>
      {open ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-preset-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div className="modal">
            <h3 id="new-preset-title">New matching preset</h3>
            <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
              <div>
                <label htmlFor="preset-key">Key (kebab-case)</label>
                <input
                  id="preset-key"
                  required
                  pattern="^[a-z][a-z0-9-]*$"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="e.g. adventurous"
                />
              </div>
              <div>
                <label htmlFor="preset-label">Label</label>
                <input
                  id="preset-label"
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Adventurous"
                />
              </div>
              <div>
                <label htmlFor="preset-desc">Description</label>
                <textarea
                  id="preset-desc"
                  required
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="preset-strategy">Strategy</label>
                <select
                  id="preset-strategy"
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
                  Weight overrides — 0 inherits the base. Normalized to sum 1 at runtime (current
                  sum {sum.toFixed(2)})
                </legend>
                {WEIGHT_KEYS.map((k) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label htmlFor={`nw-${k}`} style={{ flex: 1, margin: 0, fontSize: 13 }}>
                      {k}
                    </label>
                    <input
                      id={`nw-${k}`}
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
              <div style={{ display: "flex", gap: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  Enabled
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  Default
                </label>
              </div>
              {error ? <div className="error">{error}</div> : null}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={close}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={pending}>
                  {pending ? "Saving…" : "Create preset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
