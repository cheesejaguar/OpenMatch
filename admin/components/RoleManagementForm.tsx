"use client";

import { useTransition, useState } from "react";
import { setAdminRolesAction } from "@/lib/actions/admins";
import { ROLES, type RoleName } from "@/lib/auth/permissions";

const ROLE_NAMES = Object.keys(ROLES) as RoleName[];

export function RoleManagementForm({
  adminUserId,
  current,
}: {
  adminUserId: string;
  current: RoleName[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function onSubmit(fd: FormData) {
    setError(null);
    setOk(false);
    start(async () => {
      const res = await setAdminRolesAction(fd);
      if (!res.ok) setError(res.error);
      else setOk(true);
    });
  }

  return (
    <form action={onSubmit} className="flex flex-wrap gap-2 items-center">
      <input type="hidden" name="adminUserId" value={adminUserId} />
      {ROLE_NAMES.map((r) => (
        <label key={r} className="text-xs flex items-center gap-1">
          <input type="checkbox" name="roles" value={r} defaultChecked={current.includes(r)} />
          {ROLES[r].label}
        </label>
      ))}
      <button className="btn-primary text-xs" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      {ok ? <span className="text-xs text-ok">Saved</span> : null}
    </form>
  );
}
