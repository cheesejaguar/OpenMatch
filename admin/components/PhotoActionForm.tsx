"use client";

import { useState, useTransition } from "react";
import { actOnPhotoAction } from "@/lib/actions/photos";
import { REASON_CODES } from "@/lib/data/types";

export function PhotoActionForm({
  userId,
  photoId,
  canAct,
}: {
  userId: string;
  photoId: string;
  canAct: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"approve" | "reject" | "remove" | "escalate" | "mark_safe">(
    "approve",
  );
  if (!canAct) return null;
  const needsReason = action === "reject" || action === "remove";

  function onSubmit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await actOnPhotoAction(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <form action={onSubmit} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="photoId" value={photoId} />
      <select
        name="action"
        value={action}
        onChange={(e) => setAction(e.target.value as typeof action)}
        className="field"
      >
        <option value="approve">Approve</option>
        <option value="mark_safe">Mark safe</option>
        <option value="reject">Reject</option>
        <option value="remove">Remove</option>
        <option value="escalate">Escalate</option>
      </select>
      {needsReason ? (
        <select name="reasonCode" className="field" required>
          {REASON_CODES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      ) : null}
      <input name="note" className="field" placeholder="Optional note" />
      {error ? <div className="text-xs text-danger">{error}</div> : null}
      <button type="submit" className="btn-primary text-xs w-full justify-center" disabled={pending}>
        {pending ? "Saving…" : "Apply"}
      </button>
    </form>
  );
}
