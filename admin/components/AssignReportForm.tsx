"use client";

import { useTransition, useState } from "react";
import { assignReportAction } from "@/lib/actions/reports";

export function AssignReportForm({
  reportId,
  admins,
  current,
  canAssign,
}: {
  reportId: string;
  admins: { id: string; displayName: string }[];
  current: string | null;
  canAssign: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!canAssign) return null;
  function onSubmit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await assignReportAction(fd);
      if (!res.ok) setError(res.error);
    });
  }
  return (
    <form action={onSubmit} className="flex gap-2 items-end">
      <input type="hidden" name="reportId" value={reportId} />
      <div className="grow">
        <label className="label" htmlFor="adminUserId">Assign to</label>
        <select id="adminUserId" name="adminUserId" defaultValue={current ?? ""} className="field">
          {admins.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
      </div>
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Assign"}
      </button>
      {error ? <div className="text-sm text-danger">{error}</div> : null}
    </form>
  );
}
