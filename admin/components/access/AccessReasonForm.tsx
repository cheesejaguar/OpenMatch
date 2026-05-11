import { createAccessGrantAction } from "../../server/actions/access-grant";

const REASONS = [
  { value: "active_report_investigation", label: "Active report investigation" },
  { value: "user_appeal", label: "User appeal" },
  { value: "scam_investigation", label: "Scam / spam investigation" },
  { value: "impersonation_investigation", label: "Impersonation investigation" },
  { value: "safety_escalation", label: "Safety escalation" },
  { value: "legal_compliance", label: "Legal / compliance" },
  { value: "quality_review", label: "Quality review" },
  { value: "other", label: "Other (note required)" },
];

export default function AccessReasonForm({
  entityType,
  entityId,
  nextPath,
  reportId,
}: {
  entityType: "conversation" | "user" | "profile" | "photo" | "message";
  entityId: string;
  nextPath: string;
  reportId?: string;
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Access reason required</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        You&apos;re opening sensitive data outside an active report. State a reason. This access
        will be logged with your name and role.
      </p>
      <form action={createAccessGrantAction}>
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <input type="hidden" name="next" value={nextPath} />
        {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
        <label htmlFor="reason">Reason</label>
        <select id="reason" name="reason" defaultValue="active_report_investigation">
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label htmlFor="note" style={{ marginTop: 12 }}>
          Note (optional, required for &ldquo;Other&rdquo;)
        </label>
        <textarea id="note" name="note" rows={3} />
        <div style={{ marginTop: 16 }}>
          <button type="submit" className="primary">
            Confirm and open
          </button>
        </div>
      </form>
    </div>
  );
}
