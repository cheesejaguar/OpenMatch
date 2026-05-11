import { ACCESS_REASONS } from "@/lib/data/types";
import { grantSensitiveAccessAction } from "@/lib/actions/access";
import { SensitiveBanner } from "./SensitiveBanner";

export function AccessReasonForm(props: {
  targetEntityType: "conversation" | "user_photos" | "user_full";
  targetEntityId: string;
  redirectTo: string;
  reportId?: string | null;
  title: string;
  description: string;
}) {
  return (
    <div className="card p-6 max-w-xl">
      <SensitiveBanner>
        Accessing this content is exceptional. Choose a reason; this access will be logged
        and reviewable by audit.
      </SensitiveBanner>
      <h2 className="text-lg font-semibold mt-4">{props.title}</h2>
      <p className="text-sm text-ink-500 mt-1">{props.description}</p>
      <form action={grantSensitiveAccessAction} className="mt-4 space-y-3">
        <input type="hidden" name="targetEntityType" value={props.targetEntityType} />
        <input type="hidden" name="targetEntityId" value={props.targetEntityId} />
        <input type="hidden" name="redirectTo" value={props.redirectTo} />
        {props.reportId ? <input type="hidden" name="reportId" value={props.reportId} /> : null}
        <div>
          <label className="label" htmlFor="reason">
            Access reason
          </label>
          <select id="reason" name="reason" required className="field">
            {ACCESS_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="note">
            Note
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            className="field"
            placeholder="Brief justification (required for Other)."
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="submit" className="btn-primary">
            Confirm and view
          </button>
        </div>
      </form>
    </div>
  );
}
