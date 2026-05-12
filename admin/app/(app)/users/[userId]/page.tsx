import Link from "next/link";
import SensitiveBanner from "../../../../components/access/SensitiveBanner";
import BanForm from "../../../../components/moderation/BanForm";
import NoteForm from "../../../../components/moderation/NoteForm";
import UnbanForm from "../../../../components/moderation/UnbanForm";
import { adminFetch } from "../../../../lib/api/admin-client";
import type { UserDetailDTO } from "../../../../lib/api/types";
import { readSession } from "../../../../lib/auth/session";
import { has, PERMISSIONS } from "../../../../lib/rbac/permissions";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ userId: string }>;
}

interface NotesResponse {
  notes: Array<{
    id: string;
    body: string;
    createdByAdminUserId: string;
    createdAt: string;
  }>;
}

export default async function UserDetailPage({ params }: Params) {
  const { userId } = await params;
  const session = (await readSession())!;
  const perms = session.permissions;
  const [{ data: user, status }, { data: notes }] = await Promise.all([
    adminFetch<UserDetailDTO>(`/api/v1/admin/users/${userId}`),
    adminFetch<NotesResponse>(`/api/v1/admin/users/${userId}/notes`),
  ]);
  if (status === 404) {
    return (
      <div>
        <div className="page-header">
          <h2>User not found</h2>
        </div>
      </div>
    );
  }
  if (status !== 200) {
    return (
      <div>
        <div className="page-header">
          <h2>User</h2>
        </div>
        <div className="error">Failed to load ({status}).</div>
      </div>
    );
  }
  const canBanTemp = has(perms, PERMISSIONS.USER_BAN_TEMPORARY);
  const canBanPerm = has(perms, PERMISSIONS.USER_BAN_PERMANENT);
  const canUnban = has(perms, PERMISSIONS.USER_UNBAN);
  const canNote = has(perms, PERMISSIONS.USER_NOTE_WRITE);
  const canSeePhotos = has(perms, PERMISSIONS.PHOTO_READ_ALL);
  const canSeeMessages = has(perms, PERMISSIONS.MESSAGE_READ_ALL);

  return (
    <div>
      <SensitiveBanner />
      <div className="page-header">
        <h2>
          {user.profile?.displayName ?? user.userId}{" "}
          <span className={`badge ${user.status}`}>{user.status}</span>
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          {!user.isBanned && (canBanTemp || canBanPerm) ? (
            <BanForm
              userId={user.userId}
              displayName={user.profile?.displayName ?? null}
              canPermanent={canBanPerm}
            />
          ) : null}
          {user.isBanned && canUnban ? <UnbanForm userId={user.userId} /> : null}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Account</h3>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
            <dt className="muted">User ID</dt>
            <dd style={{ fontFamily: "var(--mono)", margin: 0 }}>{user.userId}</dd>
            <dt className="muted">Email</dt>
            <dd style={{ margin: 0 }}>{user.email ?? user.emailMasked ?? "—"}</dd>
            <dt className="muted">Age</dt>
            <dd style={{ margin: 0 }}>{user.age ?? "—"}</dd>
            <dt className="muted">Verification</dt>
            <dd style={{ margin: 0 }}>{user.verificationStatus ?? "—"}</dd>
            <dt className="muted">Joined</dt>
            <dd style={{ margin: 0 }}>{user.createdAt.slice(0, 10)}</dd>
            <dt className="muted">Last active</dt>
            <dd style={{ margin: 0 }}>{user.lastActiveAt?.slice(0, 16) ?? "—"}</dd>
            <dt className="muted">Reports</dt>
            <dd style={{ margin: 0 }}>{user.reportCount}</dd>
          </dl>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Profile</h3>
          {user.profile ? (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>{user.profile.displayName}</strong>{" "}
                <span className="muted">
                  · {user.profile.gender}
                  {user.profile.pronouns ? ` · ${user.profile.pronouns}` : ""}
                </span>
              </p>
              <p>{user.profile.bio || <span className="muted">(no bio)</span>}</p>
              <p className="muted" style={{ fontSize: 12 }}>
                {[user.profile.city, user.profile.region, user.profile.country]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {user.profile.interests.slice(0, 8).map((i) => (
                  <span key={i} className="badge">
                    {i}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="muted">No profile.</div>
          )}
          <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
            {canSeePhotos ? <Link href={`/users/${user.userId}/photos`}>View photos →</Link> : null}
            {canSeeMessages ? (
              <Link href={`/users/${user.userId}/messages`}>View conversations →</Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Bans</h3>
        {user.bans.length === 0 ? (
          <div className="muted">No prior bans.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Reason</th>
                <th>At</th>
                <th>Expires</th>
                <th>Unbanned</th>
              </tr>
            </thead>
            <tbody>
              {user.bans.map((b) => (
                <tr key={b.id}>
                  <td>{b.banType}</td>
                  <td>
                    <span className={`badge ${b.status}`}>{b.status}</span>
                  </td>
                  <td>{b.reasonCode}</td>
                  <td>{b.bannedAt.slice(0, 10)}</td>
                  <td>{b.expiresAt?.slice(0, 10) ?? "—"}</td>
                  <td>{b.unbannedAt?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Internal notes</h3>
        {canNote ? <NoteForm userId={user.userId} /> : null}
        <div style={{ marginTop: 12 }}>
          {notes?.notes && notes.notes.length > 0 ? (
            notes.notes.map((n) => (
              <div
                key={n.id}
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 8,
                  marginTop: 8,
                }}
              >
                <div className="muted" style={{ fontSize: 12 }}>
                  {n.createdAt.slice(0, 16)} · {n.createdByAdminUserId}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
              </div>
            ))
          ) : (
            <div className="muted">No notes yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
