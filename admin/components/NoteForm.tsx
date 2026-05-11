"use client";

import { useTransition, useState } from "react";
import { addInternalNoteAction } from "@/lib/actions/users";

export function NoteForm({
  targetEntityType,
  targetEntityId,
}: {
  targetEntityType: "user" | "report" | "conversation";
  targetEntityId: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");

  function onSubmit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await addInternalNoteAction(fd);
      if (!res.ok) setError(res.error);
      else setBody("");
    });
  }

  return (
    <form action={onSubmit} className="space-y-2">
      <input type="hidden" name="targetEntityType" value={targetEntityType} />
      <input type="hidden" name="targetEntityId" value={targetEntityId} />
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="field"
        placeholder="Add an internal note. Notes are visible to other admins and audit-logged."
        required
        minLength={1}
        maxLength={4000}
      />
      {error ? <div className="text-sm text-danger">{error}</div> : null}
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </button>
      </div>
    </form>
  );
}
