"use client";

import { useState, useTransition } from "react";
import { banUserAction, unbanUserAction } from "@/lib/actions/users";
import { REASON_CODES } from "@/lib/data/types";

export function BanFormButton({
  userId,
  displayName,
  currentStatus,
  canPermanent,
  canTemporary,
  reportId,
}: {
  userId: string;
  displayName: string;
  currentStatus: string;
  canPermanent: boolean;
  canTemporary: boolean;
  reportId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [banType, setBanType] = useState<"temporary" | "permanent" | "safety_hold">(
    canTemporary ? "temporary" : "permanent",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canPermanent && !canTemporary) return null;

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      const res = await banUserAction(formData);
      if (!res.ok) setError(res.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={currentStatus === "banned" || currentStatus === "suspended"}
        className="btn-danger"
      >
        Ban or suspend
      </button>
      {open ? (
        <div className="fixed inset-0 bg-ink-900/60 grid place-items-center z-50 p-4">
          <div className="card max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold">Ban or suspend {displayName}</h3>
            <p className="text-sm text-ink-500 mt-1">
              Current status: <strong>{currentStatus}</strong>. This action is reversible
              via unban, but it removes the user from discovery and revokes sessions
              immediately.
            </p>
            <form action={onSubmit} className="mt-4 space-y-3">
              <input type="hidden" name="userId" value={userId} />
              {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
              <div>
                <label className="label">Action</label>
                <div className="flex gap-2 flex-wrap">
                  {canTemporary ? (
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name="banType"
                        value="temporary"
                        checked={banType === "temporary"}
                        onChange={() => setBanType("temporary")}
                      />
                      Temporary suspension
                    </label>
                  ) : null}
                  {canPermanent ? (
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name="banType"
                        value="permanent"
                        checked={banType === "permanent"}
                        onChange={() => setBanType("permanent")}
                      />
                      Permanent ban
                    </label>
                  ) : null}
                  {canTemporary ? (
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name="banType"
                        value="safety_hold"
                        checked={banType === "safety_hold"}
                        onChange={() => setBanType("safety_hold")}
                      />
                      Safety hold
                    </label>
                  ) : null}
                </div>
              </div>
              {banType === "temporary" ? (
                <div>
                  <label className="label" htmlFor="durationDays">Duration (days)</label>
                  <input
                    type="number"
                    id="durationDays"
                    name="durationDays"
                    defaultValue={7}
                    min={1}
                    max={365}
                    className="field"
                    required
                  />
                </div>
              ) : null}
              <div>
                <label className="label" htmlFor="reasonCode">Reason</label>
                <select id="reasonCode" name="reasonCode" required className="field">
                  {REASON_CODES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="internalNote">Internal note (required)</label>
                <textarea id="internalNote" name="internalNote" rows={3} className="field" required minLength={3} />
              </div>
              <div>
                <label className="label" htmlFor="userFacingExplanation">
                  User-facing explanation (optional)
                </label>
                <textarea id="userFacingExplanation" name="userFacingExplanation" rows={2} className="field" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="revokeSessions" defaultChecked />
                Revoke active sessions
              </label>
              {banType === "permanent" ? (
                <div className="rounded-md border border-danger/30 bg-danger-soft text-danger px-3 py-2 text-sm">
                  Permanent ban is severe. Confirm the user identity and reason carefully.
                </div>
              ) : null}
              {error ? (
                <div className="text-sm text-danger">{error}</div>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="btn">
                  Cancel
                </button>
                <button type="submit" className="btn-danger" disabled={pending}>
                  {pending ? "Applying…" : banType === "permanent" ? "Permanently ban" : "Apply"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function UnbanFormButton({
  userId,
  displayName,
  canUnban,
}: {
  userId: string;
  displayName: string;
  canUnban: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canUnban) return null;

  function onSubmit(formData: FormData) {
    setError(null);
    start(async () => {
      const res = await unbanUserAction(formData);
      if (!res.ok) setError(res.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn">
        Unban
      </button>
      {open ? (
        <div className="fixed inset-0 bg-ink-900/60 grid place-items-center z-50 p-4">
          <div className="card max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold">Unban {displayName}</h3>
            <form action={onSubmit} className="mt-4 space-y-3">
              <input type="hidden" name="userId" value={userId} />
              <div>
                <label className="label" htmlFor="reason">Reason (required)</label>
                <textarea id="reason" name="reason" rows={3} className="field" required minLength={3} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="requireVerification" />
                Require verification before reactivation
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="requireProfileReview" />
                Require profile review before reactivation
              </label>
              {error ? <div className="text-sm text-danger">{error}</div> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="btn">Cancel</button>
                <button type="submit" className="btn-primary" disabled={pending}>
                  {pending ? "Unbanning…" : "Unban user"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
