"use client";

import { useState, useTransition } from "react";
import { banUserAction } from "../../server/actions/users";

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

export default function BanForm({
  userId,
  displayName,
  canPermanent,
}: {
  userId: string;
  displayName: string | null;
  canPermanent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"temporary" | "permanent" | "safety_hold">("temporary");
  const [confirmName, setConfirmName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="danger" onClick={() => setOpen(true)}>
        Ban / suspend
      </button>
    );
  }

  const isPermanent = type === "permanent";
  const namesMatch = !isPermanent || confirmName === (displayName ?? userId);

  return (
    <dialog className="modal-backdrop" aria-label="Ban user" open>
      <div className="modal">
        <h3>Ban {displayName ?? userId}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          This action is logged and notifies the user with the explanation below.
        </p>
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const result = await banUserAction(userId, formData);
              if (!result.ok) {
                setError(`Ban failed (${result.status}).`);
              } else {
                setOpen(false);
              }
            });
          }}
        >
          <label htmlFor="banType">Ban type</label>
          <select
            id="banType"
            name="banType"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="temporary">temporary suspension</option>
            {canPermanent ? <option value="permanent">permanent ban</option> : null}
            <option value="safety_hold">safety hold</option>
          </select>

          {type === "temporary" ? (
            <>
              <label htmlFor="durationDays" style={{ marginTop: 12 }}>
                Duration (days)
              </label>
              <input
                id="durationDays"
                name="durationDays"
                type="number"
                min={1}
                max={365}
                defaultValue={7}
              />
            </>
          ) : null}

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

          {isPermanent ? (
            <>
              <label htmlFor="confirmName" style={{ marginTop: 12 }}>
                Type the user&apos;s display name to confirm permanent ban
              </label>
              <input
                id="confirmName"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={displayName ?? userId}
              />
            </>
          ) : null}

          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="danger" disabled={pending || !namesMatch}>
              {pending ? "Banning…" : "Confirm ban"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
