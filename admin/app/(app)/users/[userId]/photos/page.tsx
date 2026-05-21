import Image from "next/image";
import Link from "next/link";
import SensitiveBanner from "../../../../../components/access/SensitiveBanner";
import { adminFetch } from "../../../../../lib/api/admin-client";
import type { PhotoDTO } from "../../../../../lib/api/types";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ userId: string }>;
}

export default async function UserPhotosPage({ params }: Params) {
  const { userId } = await params;
  const res = await adminFetch<{ photos: PhotoDTO[] }>(`/api/v1/admin/users/${userId}/photos`);
  const data = res.ok ? res.data : null;
  return (
    <div>
      <SensitiveBanner />
      <div className="page-header">
        <h2>Photos for {userId}</h2>
        <Link href={`/users/${userId}`}>← Back to user</Link>
      </div>
      {!res.ok ? (
        <div className="error">
          Failed to load photos ({res.status} {res.error.code}).
        </div>
      ) : data!.photos.length === 0 ? (
        <div className="card muted">No photos.</div>
      ) : (
        <div className="photo-grid">
          {data!.photos.map((p) => (
            <div key={p.id} className="photo">
              {p.url ? (
                <Image
                  src={p.url}
                  alt=""
                  width={160}
                  height={160}
                  sizes="160px"
                  style={{ width: "100%", height: 160, objectFit: "cover" }}
                />
              ) : (
                <div style={{ height: 160 }} />
              )}
              <div className="meta">
                <div>
                  <span className={`badge ${p.moderationStatus}`}>{p.moderationStatus}</span>
                </div>
                <div className="muted">order {p.sortOrder}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
