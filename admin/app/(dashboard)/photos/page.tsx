import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { PhotoActionForm } from "@/components/PhotoActionForm";
import { Empty } from "@/components/Empty";
import { hasPermission, requirePermission } from "@/lib/auth/session";
import { listUsers } from "@/lib/data/store";

type SP = { view?: string };

export default async function PhotosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePermission("photo.read.report_context");
  const sp = await searchParams;
  const view = sp.view ?? "pending";
  const users = listUsers();
  const photos = users
    .flatMap((u) =>
      u.photos.map((p) => ({ user: { id: u.id, name: u.displayName, status: u.status }, photo: p })),
    )
    .filter((row) => {
      if (view === "pending") return row.photo.moderationStatus === "under_review";
      if (view === "removed") return row.photo.moderationStatus === "removed";
      if (view === "flagged") return row.photo.moderationStatus === "restricted";
      if (view === "all") return hasPermission(session, "photo.read.all");
      return true;
    });

  const Tab = ({ value, label }: { value: string; label: string }) => (
    <Link
      href={`/photos?view=${value}`}
      className={`px-3 py-1.5 text-sm rounded-md ${
        view === value ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-100"
      } no-underline`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Photos"
        subtitle="Photo moderation queue. The 'All' tab requires photo.read.all."
      />
      <div className="flex gap-1 mb-4">
        <Tab value="pending" label="Pending review" />
        <Tab value="flagged" label="Flagged" />
        <Tab value="removed" label="Removed" />
        {hasPermission(session, "photo.read.all") ? <Tab value="all" label="All photos" /> : null}
      </div>

      {photos.length === 0 ? (
        <Empty title="No photos to review here." />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map(({ user, photo }) => (
            <div key={photo.id} className="card overflow-hidden">
              <div className="aspect-[3/4] bg-ink-100 grid place-items-center text-ink-400 text-xs">
                Photo preview
                <br />#{photo.sortOrder}
              </div>
              <div className="p-3 text-xs">
                <div className="flex justify-between items-start mb-2">
                  <Link href={`/users/${user.id}`} className="font-medium">
                    {user.name}
                  </Link>
                  <StatusBadge value={photo.moderationStatus} />
                </div>
                <div className="text-ink-500 mb-2">{photo.id.slice(0, 14)}…</div>
                <PhotoActionForm
                  userId={user.id}
                  photoId={photo.id}
                  canAct={hasPermission(session, "photo.action.review")}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
