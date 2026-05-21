import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import PhotoActions from "../../../components/moderation/PhotoActions";
import Skeleton from "../../../components/ui/Skeleton";
import { adminFetch } from "../../../lib/api/admin-client";
import type { PhotoDTO } from "../../../lib/api/types";
import { formatAge, slaBadgeClass, slaLabel, slaState } from "../../../lib/sla";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ queue?: string; cursor?: string }>;
}

// PERF-A1 / PERF-A2: render the queue tabs + heading immediately and
// stream both panels (oldest pending + filtered grid) in independent
// Suspense boundaries.
export default async function PhotosPage({ searchParams }: Params) {
  const sp = await searchParams;
  const queue = sp.queue ?? "pending";

  return (
    <div>
      <div className="page-header">
        <h2>Photo moderation</h2>
      </div>

      {queue === "pending" ? (
        <Suspense fallback={<OldestPhotosSkeleton />}>
          <OldestPhotos />
        </Suspense>
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

      <Suspense key={`${queue}|${sp.cursor ?? ""}`} fallback={<PhotoGridSkeleton />}>
        <PhotoGrid queue={queue} cursor={sp.cursor} spForLinks={sp} />
      </Suspense>
    </div>
  );
}

function OldestPhotosSkeleton() {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Oldest pending photos</h3>
      <Skeleton height={120} />
    </div>
  );
}

async function OldestPhotos() {
  const res = await adminFetch<{ photos: PhotoDTO[] }>("/api/v1/admin/photos", {
    query: { queue: "pending", limit: 5 },
  });
  const photos = res.ok ? res.data.photos : [];
  const oldest = photos
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, 5);
  if (oldest.length === 0) return null;
  const now = new Date();
  return (
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
                  <PhotoActions
                    photoId={p.id}
                    scanReasons={p.scanReasons}
                    clientFlaggedAt={p.clientFlaggedAt}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PhotoGridSkeleton() {
  return (
    <div className="photo-grid">
      {Array.from({ length: 12 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: pure-shape skeleton
        <div key={i} className="photo">
          <Skeleton width="100%" height={160} radius={0} />
          <div className="meta">
            <Skeleton height={14} />
          </div>
        </div>
      ))}
    </div>
  );
}

async function PhotoGrid({
  queue,
  cursor,
  spForLinks,
}: {
  queue: string;
  cursor: string | undefined;
  spForLinks: { queue?: string; cursor?: string };
}) {
  const res = await adminFetch<{
    photos: PhotoDTO[];
    nextCursor: string | null;
  }>("/api/v1/admin/photos", {
    query: { queue, cursor, limit: 50 },
  });
  if (!res.ok) {
    return (
      <div className="error">
        Failed to load ({res.status} {res.error.code}).
      </div>
    );
  }
  const data = res.data;
  if (data.photos.length === 0) {
    return <div className="card muted">No photos in this queue.</div>;
  }
  const now = new Date();
  return (
    <>
      <div className="photo-grid">
        {data.photos.map((p) => {
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
                  <PhotoActions
                    photoId={p.id}
                    scanReasons={p.scanReasons}
                    clientFlaggedAt={p.clientFlaggedAt}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {data.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <Link
            href={{
              pathname: "/photos",
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
