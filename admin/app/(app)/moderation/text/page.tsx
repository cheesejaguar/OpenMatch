import Link from "next/link";
import { Suspense } from "react";
import ModerationFlagActions from "../../../../components/moderation/ModerationFlagActions";
import Skeleton from "../../../../components/ui/Skeleton";
import { adminFetch } from "../../../../lib/api/admin-client";
import type { ModerationFlagListDTO } from "../../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{
    surface?: string;
    decision?: string;
    resolved?: string;
    cursor?: string;
  }>;
}

// Trust & safety automation — text moderation queue. Shows every
// ModerationFlag row the heuristic moderator (or a future plug-in
// provider) emitted; admins can dismiss / escalate from here.
export default async function TextModerationPage({ searchParams }: Params) {
  const sp = await searchParams;
  const surface = sp.surface ?? "all";
  const decision = sp.decision ?? "flag";
  const resolved = sp.resolved ?? "open";

  return (
    <div>
      <div className="page-header">
        <h2>Text moderation queue</h2>
      </div>

      <div className="toolbar">
        <FilterPills
          name="surface"
          current={surface}
          options={["all", "bio", "message", "display_name"]}
          sp={sp}
        />
        <FilterPills
          name="decision"
          current={decision}
          options={["flag", "block", "all"]}
          sp={sp}
        />
        <FilterPills
          name="resolved"
          current={resolved}
          options={["open", "resolved", "all"]}
          sp={sp}
        />
      </div>

      <Suspense
        key={`${surface}|${decision}|${resolved}|${sp.cursor ?? ""}`}
        fallback={<FlagTableSkeleton />}
      >
        <FlagTable
          surface={surface}
          decision={decision}
          resolved={resolved}
          cursor={sp.cursor}
          spForLinks={sp}
        />
      </Suspense>
    </div>
  );
}

function FilterPills({
  name,
  current,
  options,
  sp,
}: {
  name: string;
  current: string;
  options: string[];
  sp: Record<string, string | undefined>;
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {name}:
      </span>
      {options.map((o) => {
        const query = { ...sp, [name]: o };
        delete query.cursor;
        return (
          <Link
            key={o}
            href={{ pathname: "/moderation/text", query }}
            className={`badge ${current === o ? "active" : ""}`}
            style={{ padding: "4px 10px" }}
          >
            {o}
          </Link>
        );
      })}
    </div>
  );
}

function FlagTableSkeleton() {
  return (
    <div className="card">
      <Skeleton height={200} />
    </div>
  );
}

async function FlagTable({
  surface,
  decision,
  resolved,
  cursor,
  spForLinks,
}: {
  surface: string;
  decision: string;
  resolved: string;
  cursor: string | undefined;
  spForLinks: Record<string, string | undefined>;
}) {
  const res = await adminFetch<ModerationFlagListDTO>("/api/v1/admin/moderation/flags", {
    query: { surface, decision, resolved, cursor, limit: 50 },
  });
  if (!res.ok) {
    return (
      <div className="error">
        Failed to load ({res.status} {res.error.code}).
      </div>
    );
  }
  const data = res.data;
  if (data.flags.length === 0) {
    return <div className="card muted">No flags in this view.</div>;
  }
  return (
    <>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Surface</th>
              <th>Reason</th>
              <th>Decision</th>
              <th>Excerpt</th>
              <th>User</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.flags.map((f) => (
              <tr key={f.id}>
                <td style={{ fontSize: 12 }}>{new Date(f.createdAt).toLocaleString()}</td>
                <td>
                  <span className="badge">{f.surface}</span>
                </td>
                <td>
                  <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{f.reasonCode}</code>
                </td>
                <td>
                  <span className={`badge ${f.decision}`}>{f.decision}</span>
                </td>
                <td style={{ maxWidth: 320 }}>
                  {f.excerpt ? (
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{f.excerpt}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <Link href={`/users/${f.targetUserId}`}>
                    <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      {f.targetUserId.slice(0, 10)}…
                    </code>
                  </Link>
                </td>
                <td>
                  {f.resolvedAt ? (
                    <span className="muted">{f.resolution ?? "resolved"}</span>
                  ) : (
                    <ModerationFlagActions flagId={f.id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={{
              pathname: "/moderation/text",
              query: { ...spForLinks, cursor: data.nextCursor },
            }}
          >
            Next page →
          </Link>
        </div>
      ) : null}
    </>
  );
}
