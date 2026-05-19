import Link from "next/link";
import GenerateBatchModal from "../../../components/invites/GenerateBatchModal";
import RevokeButton from "../../../components/invites/RevokeButton";
import Badge, { type BadgeVariant } from "../../../components/ui/Badge";
import FilterBar from "../../../components/ui/FilterBar";
import { adminFetch } from "../../../lib/api/admin-client";
import type { InviteCodeDTO, InviteListDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ cohort?: string; status?: string; cursor?: string }>;
}

type InviteStatus = "active" | "revoked" | "expired" | "exhausted";

function deriveStatus(row: InviteCodeDTO, now: Date): InviteStatus {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && new Date(row.expiresAt) < now) return "expired";
  if (row.usedCount >= row.maxUses) return "exhausted";
  return "active";
}

const STATUS_VARIANT: Record<InviteStatus, BadgeVariant> = {
  active: "success",
  revoked: "danger",
  expired: "warning",
  exhausted: "info",
};

export default async function InvitesPage({ searchParams }: Params) {
  const sp = await searchParams;
  const status =
    sp.status && ["active", "revoked", "expired", "exhausted"].includes(sp.status)
      ? sp.status
      : "all";
  const { data, status: httpStatus } = await adminFetch<InviteListDTO>("/api/v1/admin/invites", {
    query: {
      cohort: sp.cohort,
      status: status as string,
      cursor: sp.cursor,
      limit: 100,
    },
  });

  const cohortLabels = Array.from(new Set((data?.items ?? []).map((i) => i.cohortLabel))).sort();
  const now = new Date();

  return (
    <div>
      <div className="page-header">
        <h2>Invite codes</h2>
        <GenerateBatchModal />
      </div>

      <form action="/invites" method="get" style={{ marginBottom: 12 }}>
        <FilterBar
          action={
            <button type="submit" className="primary">
              Filter
            </button>
          }
        >
          <div style={{ width: 200 }}>
            <label htmlFor="cohort">Cohort</label>
            <select id="cohort" name="cohort" defaultValue={sp.cohort ?? ""}>
              <option value="">All cohorts</option>
              {cohortLabels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div style={{ width: 160 }}>
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={status}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="revoked">Revoked</option>
              <option value="expired">Expired</option>
              <option value="exhausted">Used-up</option>
            </select>
          </div>
        </FilterBar>
      </form>

      {httpStatus !== 200 ? (
        <div className="error">Failed to load ({httpStatus}).</div>
      ) : data.items.length === 0 ? (
        <div className="card muted">No invite codes match those filters.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Cohort</th>
                <th>Uses</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Created</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((inv) => {
                const st = deriveStatus(inv, now);
                return (
                  <tr key={inv.id}>
                    <td>
                      <code style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{inv.code}</code>
                    </td>
                    <td>{inv.cohortLabel}</td>
                    <td>
                      {inv.usedCount} / {inv.maxUses}
                    </td>
                    <td className="muted">
                      {inv.expiresAt ? inv.expiresAt.slice(0, 16).replace("T", " ") : "—"}
                    </td>
                    <td>
                      <Badge variant={STATUS_VARIANT[st]}>{st}</Badge>
                    </td>
                    <td className="muted">{inv.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td>
                      <RevokeButton
                        inviteId={inv.id}
                        disabled={st === "revoked" || st === "expired"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link href={{ pathname: "/invites", query: { ...sp, cursor: data.nextCursor } }}>
            Next page →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
