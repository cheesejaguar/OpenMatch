import Image from "next/image";
import Link from "next/link";
import PhotoActions from "../../../components/moderation/PhotoActions";
import { adminFetch } from "../../../lib/api/admin-client";
import type { PhotoDTO } from "../../../lib/api/types";
import { formatAge, slaBadgeClass, slaLabel, slaState } from "../../../lib/sla";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ queue?: string; cursor?: string }>;
}

export default async function PhotosPage({ searchParams }: Params) {
  const sp = await searchParams;
  const queue = sp.queue ?? "pending";

  // PERF-A2: fetch the main list and (on the "pending" queue) the
  // oldest-pending panel in parallel. The oldest panel only renders
  // on `queue === "pending"`, so on other queues we skip the second
  // fetch entirely.
  const [res, oldestRes] = await Promise.all([
    adminFetch<{
      photos: PhotoDTO[];
      nextCursor: string | null;
    }>("/api/v1/admin/photos", {
      query: { queue, cursor: sp.cursor, limit: 50 },
    }),
    queue === "pending"
      ? adminFetch<{ photos: PhotoDTO[] }>("/api/v1/admin/photos", {
          query: { queue: "pending", limit: 5 },
        })
      : Promise.resolve(null),
  ]);
  const data = res.ok ? res.data : null;
  const status = res.status;

  const oldestPhotos = oldestRes && oldestRes.ok ? oldestRes.data.photos : [];
  const oldest = oldestPhotos
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, 5);

  const now = new Date();

  return (
    <div>
      <div className="page-header">
        <h2>Photo moderation</h2>
      </div>

      {oldest.length > 0 ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Oldest pending photos</h3>
          <table>
            <thead>
              <tr>
                <th>Photo</th>
                <th>Age</th>
                <th>SLA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {oldest.map((p) => {
                const st = slaState(p.createdAt, undefined, now);
                return (
                  <tr key={p.id}>
                    <td>
                      <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                        {p.id.slice(0, 10)}…
                      </code>
                    </td>
                    <td>{formatAge(p.createdAt, now)}</td>
                    <td>
                      <span className={slaBadgeClass(st)}>{slaLabel(st)}</span>
                    </td>
                    <td>
                      <PhotoActions photoId={p.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="toolbar">
        {["pending", "flagged", "removed", "all"].map((q) => (
          <Link
            key={q}
            href={{ pathname: "/photos", query: { queue: q } }}
            className={`badge ${queue === q ? "active" : ""}`}
            style={{ padding: "4px 12px" }}
          >
            {q}
          </Link>
        ))}
      </div>
      {!res.ok ? (
        <div className="error">
          Failed to load ({status} {res.error.code}).
        </div>
      ) : data!.photos.length === 0 ? (
        <div className="card muted">No photos in this queue.</div>
      ) : (
        <div className="photo-grid">
          {data!.photos.map((p) => {
            const isOpen = p.moderationStatus === "pending" || p.moderationStatus === "flagged";
            const st = isOpen ? slaState(p.createdAt, undefined, now) : null;
            return (
              <div key={p.id} className="photo">
                {p.url ? (
                  <Image
                    src={p.url}
                    alt=""
                    width={160}
                    height={160}
                    sizes="160px"
                    // CSS forces 100% width × 160px height with object-fit:
                    // cover; the explicit dims here just lock the intrinsic
                    // aspect ratio for the layout pass.
                    style={{ width: "100%", height: 160, objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ height: 160 }} />
                )}
                <div className="meta">
                  <div>
                    <span className={`badge ${p.moderationStatus}`}>{p.moderationStatus}</span>
                  </div>
                  <div className="muted">Queue age: {formatAge(p.createdAt, now)}</div>
                  {st ? (
                    <div style={{ marginTop: 4 }}>
                      <span className={slaBadgeClass(st)}>{slaLabel(st)}</span>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 8 }}>
                    <PhotoActions photoId={p.id} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={{
              pathname: "/photos",
              query: { ...sp, cursor: data.nextCursor },
            }}
          >
            Next page →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
