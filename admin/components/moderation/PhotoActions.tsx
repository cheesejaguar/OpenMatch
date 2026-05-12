"use client";

import { useState, useTransition } from "react";
import { photoActionAction } from "../../server/actions/photos";

export default function PhotoActions({ photoId }: { photoId: string }) {
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

  return (
    <div>
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
