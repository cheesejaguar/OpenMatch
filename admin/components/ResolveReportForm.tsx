"use client";

import { useState, useTransition } from "react";
import { resolveReportAction } from "@/lib/actions/reports";
import { REASON_CODES } from "@/lib/data/types";

export function ResolveReportForm({
  reportId,
  canResolve,
}: {
  reportId: string;
  canResolve: boolean;
}) {
  const [decision, setDecision] = useState<
    "no_action" | "warning" | "content_removed" | "temporary_suspension" | "permanent_ban" | "escalated" | "dismissed"
  >("no_action");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canResolve) {
    return <div className="text-sm text-ink-500">Your role cannot resolve reports.</div>;
  }

  function onSubmit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await resolveReportAction(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <input type="hidden" name="reportId" value={reportId} />
      <div>
        <label className="label" htmlFor="decision">Resolution</label>
        <select
          id="decision"
          name="decision"
          className="field"
          value={decision}
          onChange={(e) => setDecision(e.target.value as typeof decision)}
        >
          <option value="no_action">No violation</option>
          <option value="warning">Warn user</option>
          <option value="content_removed">Remove content</option>
          <option value="temporary_suspension">Temporary suspension</option>
          <option value="permanent_ban">Permanent ban</option>
          <option value="escalated">Escalate</option>
          <option value="dismissed">Dismiss</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="reasonCode">Reason code</label>
        <select id="reasonCode" name="reasonCode" className="field" defaultValue="">
          <option value="">— none —</option>
          {REASON_CODES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="internalNote">Internal note (required)</label>
        <textarea
          id="internalNote"
          name="internalNote"
          rows={3}
          required
          minLength={3}
          className="field"
          placeholder="Document the basis for this decision."
        />
      </div>
      <div>
        <label className="label" htmlFor="userFacingExplanation">
          User-facing explanation (optional)
        </label>
        <textarea
          id="userFacingExplanation"
          name="userFacingExplanation"
          rows={2}
          className="field"
        />
      </div>
      {decision === "permanent_ban" ? (
        <div className="rounded-md border border-danger/30 bg-danger-soft text-danger px-3 py-2 text-sm">
          Permanent bans are severe. Confirm the user is correctly identified and the reason
          is documented.
        </div>
      ) : null}
      {error ? <div className="text-sm text-danger">{error}</div> : null}
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Apply resolution"}
        </button>
      </div>
    </form>
  );
}
