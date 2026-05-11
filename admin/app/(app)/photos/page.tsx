import Link from "next/link";
import PhotoActions from "../../../components/moderation/PhotoActions";
import { adminFetch } from "../../../lib/api/admin-client";
import type { PhotoDTO } from "../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ queue?: string; cursor?: string }>;
}

export default async function PhotosPage({ searchParams }: Params) {
  const sp = await searchParams;
  const { data, status } = await adminFetch<{
    photos: PhotoDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/photos", {
    query: { queue: sp.queue ?? "pending", cursor: sp.cursor, limit: 50 },
  });

  return (
    <div>
      <div className="page-header">
        <h2>Photo moderation</h2>
      </div>
      <div className="toolbar">
        {["pending", "flagged", "removed", "all"].map((q) => (
          <Link
            key={q}
            href={{ pathname: "/photos", query: { queue: q } }}
            className={`badge ${sp.queue === q || (!sp.queue && q === "pending") ? "active" : ""}`}
            style={{ padding: "4px 12px" }}
          >
            {q}
          </Link>
        ))}
      </div>
      {status !== 200 ? (
        <div className="error">Failed to load ({status}).</div>
      ) : data.photos.length === 0 ? (
        <div className="card muted">No photos in this queue.</div>
      ) : (
        <div className="photo-grid">
          {data.photos.map((p) => (
            <div key={p.id} className="photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.url ? <img src={p.url} alt="" /> : <div style={{ height: 160 }} />}
              <div className="meta">
                <div>
                  <span className={`badge ${p.moderationStatus}`}>{p.moderationStatus}</span>
                </div>
                <div className="muted">{p.createdAt.slice(0, 10)}</div>
                <div style={{ marginTop: 8 }}>
                  <PhotoActions photoId={p.id} />
                </div>
              </div>
            </div>
          ))}
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
