"use client";

import { useState, useTransition } from "react";
import { photoActionAction } from "../../server/actions/photos";

// Trust & safety automation — surfacing scan reasons next to the
// approve/reject controls means a triager doesn't have to click into
// the photo to know what fired the queue entry.
export default function PhotoActions({
  photoId,
  scanReasons,
  clientFlaggedAt,
}: {
  photoId: string;
  scanReasons?: Array<{ source?: string; code?: string; score?: number }> | null;
  clientFlaggedAt?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: "approve" | "reject" | "remove") => {
    setError(null);
    startTransition(async () => {
      const reasonCode = action === "approve" ? "other" : "offensive_profile";
      const r = await photoActionAction(photoId, action, reasonCode, "");
      if (!r.ok) setError(`Failed (${r.status}).`);
    });
  };

  const reasons = scanReasons ?? [];

  return (
    <div>
      {(reasons.length > 0 || clientFlaggedAt) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {clientFlaggedAt ? (
            <span className="badge" title="Flagged by on-device scan">
              client-flagged
            </span>
          ) : null}
          {reasons.map((r, idx) => {
            const reasonKey = `${r.source ?? "u"}:${r.code ?? "u"}:${r.score ?? idx}`;
            return (
              <span key={reasonKey} className="badge" title={r.source ?? "scanner"}>
                {r.code ?? "scan"}
                {typeof r.score === "number" ? ` (${Math.round(r.score)})` : ""}
              </span>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" onClick={() => run("approve")} disabled={pending}>
          Approve
        </button>
        <button type="button" onClick={() => run("reject")} disabled={pending}>
          Reject
        </button>
        <button type="button" onClick={() => run("remove")} className="danger" disabled={pending}>
          Remove
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
