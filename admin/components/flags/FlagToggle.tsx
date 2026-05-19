"use client";

import { useState, useTransition } from "react";
import { toggleFlag } from "../../server/actions/flags";

// Inline switch that wraps the toggle server action. Optimistic state
// is kept locally; on failure we revert and surface a "toast" line.
export default function FlagToggle({
  flagKey,
  initialEnabled,
}: {
  flagKey: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  function flip() {
    const next = !enabled;
    setEnabled(next);
    setToast(null);
    startTransition(async () => {
      const res = await toggleFlag(flagKey, next);
      if (!res.ok) {
        setEnabled(!next); // revert
        setToast({ kind: "err", msg: res.error ?? `Server returned ${res.status}` });
      } else {
        setToast({ kind: "ok", msg: next ? "Flag enabled" : "Flag disabled" });
        setTimeout(() => setToast(null), 1800);
      }
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <label className="switch" aria-label={`${flagKey} flag toggle`}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={flip}
          disabled={pending}
          aria-checked={enabled}
        />
        <span className="slider" aria-hidden="true" />
      </label>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: enabled ? "var(--success)" : "var(--fg-muted)",
        }}
      >
        {enabled ? "ON" : "OFF"}
      </span>
      {toast ? (
        <span
          className={toast.kind === "ok" ? "success" : "error"}
          style={{ marginTop: 0, marginLeft: 8 }}
        >
          {toast.msg}
        </span>
      ) : null}
    </div>
  );
}
