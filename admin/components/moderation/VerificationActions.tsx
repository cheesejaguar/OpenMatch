"use client";

import { useState, useTransition } from "react";
import { decideVerificationAction } from "../../server/actions/moderation";

export default function VerificationActions({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: "approve" | "reject") => {
    setError(null);
    startTransition(async () => {
      const r = await decideVerificationAction(requestId, action);
      if (!r.ok) setError(`Failed (${r.status}).`);
    });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" onClick={() => run("approve")} disabled={pending}>
          Approve
        </button>
        <button type="button" onClick={() => run("reject")} className="danger" disabled={pending}>
          Reject
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
