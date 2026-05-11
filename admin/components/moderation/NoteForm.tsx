"use client";

import { useRef, useState, useTransition } from "react";
import { addNoteAction } from "../../server/actions/users";

export default function NoteForm({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const r = await addNoteAction(userId, formData);
          if (!r.ok) setError(`Failed (${r.status}).`);
          else ref.current?.reset();
        });
      }}
    >
      <label htmlFor="body">New internal note</label>
      <textarea id="body" name="body" rows={3} required />
      {error ? <div className="error">{error}</div> : null}
      <div style={{ marginTop: 8 }}>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </button>
      </div>
    </form>
  );
}
