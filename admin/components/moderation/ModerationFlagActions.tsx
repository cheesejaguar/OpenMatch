"use client";

import { useState, useTransition } from "react";
import { resolveModerationFlagAction } from "../../server/actions/moderation";

export default function ModerationFlagActions({ flagId }: { flagId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (resolution: "dismissed" | "warned" | "removed" | "banned") => {
    setError(null);
    startTransition(async () => {
      const r = await resolveModerationFlagAction(flagId, resolution);
      if (!r.ok) setError(`Failed (${r.status}).`);
    });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button type="button" onClick={() => run("dismissed")} disabled={pending}>
          Dismiss
        </button>
        <button type="button" onClick={() => run("warned")} disabled={pending}>
          Warn
        </button>
        <button type="button" onClick={() => run("removed")} className="danger" disabled={pending}>
          Remove
        </button>
        <button type="button" onClick={() => run("banned")} className="danger" disabled={pending}>
          Ban
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
