import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SensitiveBanner } from "@/components/SensitiveBanner";
import { BanFormButton, UnbanFormButton } from "@/components/BanModal";
import { NoteForm } from "@/components/NoteForm";
import { PhotoActionForm } from "@/components/PhotoActionForm";
import { AccessReasonForm } from "@/components/AccessReasonForm";
import { hasPermission, requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import {
  activeBanForUser,
  findActiveGrant,
  getAdminUserById,
  getUserById,
  listBansForUser,
  listConversations,
  listModerationActionsForUser,
  listNotes,
  listReportsByUserId,
} from "@/lib/data/store";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm text-ink-800">{children ?? "—"}</div>
    </div>
  );
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await requirePermission("user.read.full_profile");
  const user = getUserById(userId);
  if (!user) notFound();

  const canPhotosAll = hasPermission(session, "photo.read.all");
  const canMessagesAll = hasPermission(session, "message.read.all");
  const canPrivateFields = hasPermission(session, "user.read.private_fields");
  const photosGrant = findActiveGrant(session.adminUserId, "user_photos", user.id);
  const privateGrant = findActiveGrant(session.adminUserId, "user_full", user.id);
  const photosUnlocked = canPhotosAll && !!photosGrant;
  const privateUnlocked = canPrivateFields && !!privateGrant;

  await writeAudit({
    session,
    eventType: "user.viewed",
    targetEntityType: "user",
    targetEntityId: user.id,
    accessReason: privateGrant?.reason ?? null,
  });

  const reports = listReportsByUserId(user.id);
  const reportsAbout = reports.filter((r) => r.reportedUserId === user.id);
  const bans = listBansForUser(user.id);
  const activeBan = activeBanForUser(user.id);
  const actions = listModerationActionsForUser(user.id);
  const notes = listNotes("user", user.id);
  const convos = listConversations({ userId: user.id });

  return (
    <>
      <PageHeader
        title={user.displayName}
        subtitle={`${user.id} · ${user.profileId}`}
        actions={
          <>
            <BanFormButton
              userId={user.id}
              displayName={user.displayName}
              currentStatus={user.status}
              canTemporary={hasPermission(session, "user.ban.temporary")}
              canPermanent={hasPermission(session, "user.ban.permanent")}
            />
            {activeBan ? (
              <UnbanFormButton
                userId={user.id}
                displayName={user.displayName}
                canUnban={hasPermission(session, "user.unban")}
              />
            ) : null}
          </>
        }
      />
      <div className="flex gap-2 flex-wrap mb-4">
        <StatusBadge value={user.status} />
        <StatusBadge value={user.visibilityStatus} />
        <StatusBadge value={user.moderationStatus} />
        <StatusBadge value={user.verificationStatus} />
        {activeBan ? <StatusBadge value="banned" /> : null}
      </div>

      {activeBan ? (
        <div className="card border-danger/40 bg-danger-soft/40 p-4 mb-6">
          <div className="font-semibold text-danger">Active {activeBan.banType} ban</div>
          <div className="text-sm text-ink-700 mt-1">
            Reason: <strong>{activeBan.reasonCode}</strong> · Issued{" "}
            {new Date(activeBan.bannedAt).toLocaleString()}{" "}
            {activeBan.expiresAt ? `· expires ${new Date(activeBan.expiresAt).toLocaleString()}` : ""}
          </div>
          <div className="text-sm text-ink-700 mt-1">Note: {activeBan.internalNote}</div>
        </div>
      ) : null}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Profile */}
        <section className="card p-4">
          <h2 className="font-semibold text-ink-700 mb-3">Public profile</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age">{user.age}</Field>
            <Field label="Gender">{user.gender}</Field>
            <Field label="Pronouns">{user.pronouns ?? "—"}</Field>
            <Field label="Height (cm)">{user.heightCm ?? "—"}</Field>
            <Field label="City">{user.city ?? "—"}</Field>
            <Field label="Country">{user.country ?? "—"}</Field>
            <Field label="College">{user.college ?? "—"}</Field>
            <Field label="Job">{user.jobTitle ?? "—"}</Field>
            <Field label="Relationship goal">{user.relationshipGoal ?? "—"}</Field>
            <Field label="Diet">{user.diet ?? "—"}</Field>
          </div>
          <div className="mt-3">
            <Field label="Bio">{user.bio}</Field>
          </div>
          <div className="mt-3">
            <div className="label">Interests</div>
            <div className="flex flex-wrap gap-1">
              {user.interests.map((i) => (
                <span key={i} className="badge bg-ink-100 text-ink-700">{i}</span>
              ))}
              {user.interests.length === 0 ? <span className="text-ink-500 text-sm">—</span> : null}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {user.prompts.map((p, i) => (
              <div key={i} className="text-sm">
                <div className="text-ink-500">{p.question}</div>
                <div className="text-ink-800">{p.answer}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Account */}
        <section className="card p-4">
          <h2 className="font-semibold text-ink-700 mb-3">Account</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Created">{new Date(user.createdAt).toLocaleString()}</Field>
            <Field label="Last active">{new Date(user.lastActiveAt).toLocaleString()}</Field>
            <Field label="Email hash">{user.emailHashedDisplay}</Field>
            <Field label="Phone hash">{user.phoneHashedDisplay ?? "—"}</Field>
          </div>

          <h3 className="font-semibold text-ink-700 mt-5 mb-2">Private fields</h3>
          {!canPrivateFields ? (
            <div className="text-sm text-ink-500">
              Your role does not include <code>user.read.private_fields</code>.
            </div>
          ) : privateUnlocked ? (
            <>
              <SensitiveBanner />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Field label="Date of birth">
                  {new Date(user.dateOfBirth).toLocaleDateString()}
                </Field>
                <Field label="Region">{user.region ?? "—"}</Field>
              </div>
            </>
          ) : (
            <AccessReasonForm
              targetEntityType="user_full"
              targetEntityId={user.id}
              redirectTo={`/users/${user.id}`}
              title="View private fields"
              description="Choose a reason to reveal exact date of birth and region metadata."
            />
          )}

          <h3 className="font-semibold text-ink-700 mt-5 mb-2">Preferences</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age range">
              {user.preferences.minAge}–{user.preferences.maxAge}
            </Field>
            <Field label="Max distance (km)">{user.preferences.maxDistanceKm}</Field>
            <Field label="Interested in">{user.preferences.interestedGenders.join(", ")}</Field>
            <Field label="Goals">{user.preferences.relationshipGoals.join(", ")}</Field>
          </div>
        </section>
      </div>

      {/* Photos */}
      <section className="card p-4 mt-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold text-ink-700">Photos</h2>
          <div className="text-xs text-ink-500">
            Permission required: <code>photo.read.all</code>
          </div>
        </div>
        {!canPhotosAll ? (
          <div className="text-sm text-ink-500">
            Your role only supports report-context photo access.
          </div>
        ) : photosUnlocked ? (
          <>
            <SensitiveBanner>
              You are viewing all photos for this user outside a report context.
            </SensitiveBanner>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
              {user.photos.map((p) => (
                <div key={p.id} className="border rounded-md overflow-hidden border-ink-200">
                  <div className="aspect-[3/4] bg-ink-100 grid place-items-center text-ink-400 text-xs">
                    Photo preview
                    <br />#{p.sortOrder}
                  </div>
                  <div className="p-2 text-xs">
                    <div className="flex justify-between items-center mb-1">
                      <StatusBadge value={p.moderationStatus} />
                      <span className="text-ink-500">{p.id.slice(0, 10)}…</span>
                    </div>
                    <PhotoActionForm
                      userId={user.id}
                      photoId={p.id}
                      canAct={hasPermission(session, "photo.action.review")}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <AccessReasonForm
            targetEntityType="user_photos"
            targetEntityId={user.id}
            redirectTo={`/users/${user.id}`}
            title="View all photos"
            description="Photo gallery access outside a report context requires a reason."
          />
        )}
      </section>

      {/* Messages */}
      <section className="card p-4 mt-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold text-ink-700">Conversations</h2>
          {!canMessagesAll ? (
            <span className="text-xs text-ink-500">
              Requires <code>message.read.all</code>
            </span>
          ) : null}
        </div>
        {convos.length === 0 ? (
          <div className="text-sm text-ink-500">No conversations.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {convos.map((c) => (
              <li key={c.id} className="py-2 flex justify-between items-center">
                <div>
                  <div className="font-medium">{c.id}</div>
                  <div className="text-xs text-ink-500">
                    {c.participantUserIds.join(" ↔ ")} · {new Date(c.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <Link href={`/conversations/${c.id}`} className="btn">Open</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Reports involving user */}
      <section className="card p-4 mt-6">
        <h2 className="font-semibold text-ink-700 mb-3">
          Reports involving this user ({reports.length})
        </h2>
        {reports.length === 0 ? (
          <div className="text-sm text-ink-500">No related reports.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Role</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/reports/${r.id}`}>{r.id}</Link></td>
                  <td>{r.reportedUserId === user.id ? "reported" : "reporter"}</td>
                  <td>{r.reason.replaceAll("_", " ")}</td>
                  <td><StatusBadge value={r.status} /></td>
                  <td className="text-ink-500">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Moderation history */}
      <section className="card p-4 mt-6">
        <h2 className="font-semibold text-ink-700 mb-3">Moderation history</h2>
        {bans.length === 0 && actions.length === 0 ? (
          <div className="text-sm text-ink-500">No moderation history.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Admin</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {bans.map((b) => (
                <tr key={b.id}>
                  <td className="text-ink-500">{new Date(b.bannedAt).toLocaleString()}</td>
                  <td>
                    <StatusBadge value={b.status === "active" ? b.banType : "lifted"} />
                  </td>
                  <td>{b.reasonCode}</td>
                  <td>{getAdminUserById(b.bannedByAdminUserId)?.displayName ?? b.bannedByAdminUserId}</td>
                  <td className="max-w-md">{b.internalNote}</td>
                </tr>
              ))}
              {actions.filter((a) => a.actionType !== "permanent_ban" && a.actionType !== "temporary_suspension").map((a) => (
                <tr key={a.id}>
                  <td className="text-ink-500">{new Date(a.createdAt).toLocaleString()}</td>
                  <td>{a.actionType.replaceAll("_", " ")}</td>
                  <td>{a.reasonCode ?? "—"}</td>
                  <td>{getAdminUserById(a.createdByAdminUserId)?.displayName ?? a.createdByAdminUserId}</td>
                  <td className="max-w-md">{a.internalNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Internal notes */}
      <section className="card p-4 mt-6">
        <h2 className="font-semibold text-ink-700 mb-3">Internal notes</h2>
        {hasPermission(session, "note.write") ? (
          <NoteForm targetEntityType="user" targetEntityId={user.id} />
        ) : (
          <div className="text-sm text-ink-500">Your role cannot add notes.</div>
        )}
        <ul className="mt-4 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-ink-200 pl-3">
              <div className="text-sm">{n.body}</div>
              <div className="text-xs text-ink-500 mt-0.5">
                {getAdminUserById(n.createdByAdminUserId)?.displayName ?? n.createdByAdminUserId} ·{" "}
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </li>
          ))}
          {notes.length === 0 ? <li className="text-sm text-ink-500">No notes.</li> : null}
        </ul>
      </section>

      <div className="text-xs text-ink-500 mt-6">
        Reports about this user: {reportsAbout.length}. Audit entry written for this view.
      </div>
    </>
  );
}
