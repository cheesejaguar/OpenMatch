"use client";

import { useState, useTransition } from "react";
import {
  dismissReportAction,
  escalateReportAction,
  resolveReportAction,
} from "../../server/actions/reports";

const RESOLUTIONS = [
  { value: "no_action", label: "No action" },
  { value: "warning", label: "Warn user" },
  { value: "content_removed", label: "Remove content" },
  { value: "temporary_suspension", label: "Suspend (temporary)" },
  { value: "permanent_ban", label: "Permanent ban" },
];

const REASONS = [
  "harassment",
  "hate_or_discrimination",
  "threats_or_violence",
  "sexual_content",
  "scam_or_spam",
  "fake_profile",
  "underage",
  "impersonation",
  "offensive_profile",
  "off_platform_solicitation",
  "ban_evasion",
  "other",
];

export default function ResolveForm({
  reportId,
  permissions,
}: {
  reportId: string;
  permissions: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canPermanent = permissions.includes("user.ban.permanent");
  const visible = RESOLUTIONS.filter((r) => r.value !== "permanent_ban" || canPermanent);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Action panel</h3>
      <form
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const r = await resolveReportAction(reportId, formData);
            if (!r.ok) setError(`Failed (${r.status}).`);
          });
        }}
      >
        <label htmlFor="resolution">Resolution</label>
        <select id="resolution" name="resolution" defaultValue="no_action">
          {visible.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label htmlFor="reasonCode" style={{ marginTop: 12 }}>
          Reason
        </label>
        <select id="reasonCode" name="reasonCode" defaultValue="harassment">
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label htmlFor="internalNote" style={{ marginTop: 12 }}>
          Internal note
        </label>
        <textarea id="internalNote" name="internalNote" rows={3} required />
        <label htmlFor="userFacingExplanation" style={{ marginTop: 12 }}>
          User-facing explanation (optional)
        </label>
        <textarea id="userFacingExplanation" name="userFacingExplanation" rows={2} />
        {error ? <div className="error">{error}</div> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? "Resolving…" : "Resolve report"}
          </button>
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                const r = await dismissReportAction(reportId);
                if (!r.ok) setError(`Failed (${r.status}).`);
              })
            }
            disabled={pending}
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                const r = await escalateReportAction(reportId);
                if (!r.ok) setError(`Failed (${r.status}).`);
              })
            }
            disabled={pending}
          >
            Escalate
          </button>
        </div>
      </form>
    </div>
  );
}
