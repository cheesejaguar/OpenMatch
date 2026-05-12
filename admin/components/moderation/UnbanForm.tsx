"use client";

import { useState, useTransition } from "react";
import { unbanUserAction } from "../../server/actions/users";

export default function UnbanForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Unban
      </button>
    );
  }

  return (
    <dialog className="modal-backdrop" aria-label="Unban user" open>
      <div className="modal">
        <h3>Unban user</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          The active ban will be lifted. Optionally require verification or profile review.
        </p>
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const r = await unbanUserAction(userId, formData);
              if (!r.ok) setError(`Unban failed (${r.status}).`);
              else setOpen(false);
            });
          }}
        >
          <label htmlFor="reason">Reason for unban</label>
          <textarea id="reason" name="reason" rows={3} required />
          <label htmlFor="internalNote" style={{ marginTop: 12 }}>
            Internal note (optional)
          </label>
          <textarea id="internalNote" name="internalNote" rows={2} />
          <label style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="requireVerification" /> Require verification
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="requireProfileReview" /> Require profile review
          </label>
          {error ? <div className="error">{error}</div> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={pending}>
              {pending ? "Unbanning…" : "Confirm unban"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
