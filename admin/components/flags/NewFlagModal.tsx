"use client";

import { useState, useTransition } from "react";
import { createFlag } from "../../server/actions/flags";

// Modal for creating a brand-new feature flag. The variants textarea
// accepts JSON; we parse client-side and surface a "must be JSON"
// error rather than letting the backend reject it later.
export default function NewFlagModal() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [variantsRaw, setVariantsRaw] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setKey("");
    setDescription("");
    setEnabled(false);
    setVariantsRaw("");
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    let variants: Record<string, unknown> | null = null;
    if (variantsRaw.trim()) {
      try {
        const parsed = JSON.parse(variantsRaw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setError("variants must be a JSON object");
          return;
        }
        variants = parsed as Record<string, unknown>;
      } catch {
        setError("variants is not valid JSON");
        return;
      }
    }
    startTransition(async () => {
      const res = await createFlag({ key, description, enabled, variants });
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
        New flag
      </button>
      {open ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="newflag-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div className="modal">
            <h3 id="newflag-title">New feature flag</h3>
            <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
              <div>
                <label htmlFor="flag-key">Key (snake_case)</label>
                <input
                  id="flag-key"
                  required
                  pattern="^[a-z][a-z0-9_]*$"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="e.g. likes_visibility_v2"
                />
              </div>
              <div>
                <label htmlFor="flag-desc">Description</label>
                <textarea
                  id="flag-desc"
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  id="flag-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  style={{ width: "auto" }}
                />
                <label htmlFor="flag-enabled" style={{ margin: 0 }}>
                  Enabled by default
                </label>
              </div>
              <div>
                <label htmlFor="flag-variants">Variants (optional JSON)</label>
                <textarea
                  id="flag-variants"
                  rows={4}
                  value={variantsRaw}
                  onChange={(e) => setVariantsRaw(e.target.value)}
                  placeholder='{"treatment": "v2", "rollout_pct": 25}'
                  style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                />
              </div>
              {error ? <div className="error">{error}</div> : null}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={close}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={pending}>
                  {pending ? "Saving…" : "Create flag"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
