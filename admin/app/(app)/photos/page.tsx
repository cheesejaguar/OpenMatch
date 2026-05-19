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
  const res = await adminFetch<{
    photos: PhotoDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/photos", {
    query: { queue, cursor: sp.cursor, limit: 50 },
  });
  const data = res.ok ? res.data : null;
  const status = res.status;

  // Oldest panel only shows for the "pending" queue — that's where
  // SLA pressure is real. Other queues are historical.
  const oldestRes =
    res.ok && queue === "pending"
      ? await adminFetch<{ photos: PhotoDTO[] }>("/api/v1/admin/photos", {
          query: { queue: "pending", limit: 5 },
        })
      : null;
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url ? <img src={p.url} alt="" /> : <div style={{ height: 160 }} />}
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
