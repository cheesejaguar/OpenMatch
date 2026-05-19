"use client";

import { useState, useTransition } from "react";
import { revokeInvite } from "../../server/actions/invites";

// Inline action — confirms, then calls the revoke server action.
// Disabled when the invite is already revoked/expired.
export default function RevokeButton({
  inviteId,
  disabled,
}: {
  inviteId: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (disabled) return;
    if (!confirm("Revoke this invite code? Users who haven't redeemed it yet will be blocked.")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await revokeInvite(inviteId);
      if (!res.ok) setError(res.error ?? String(res.status));
    });
  }
  return (
    <>
      <button
        type="button"
        className="danger"
        onClick={onClick}
        disabled={disabled || pending}
        style={{ padding: "4px 10px", fontSize: 12 }}
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {error ? (
        <div className="error" style={{ marginTop: 4 }}>
          {error}
        </div>
      ) : null}
    </>
  );
}
