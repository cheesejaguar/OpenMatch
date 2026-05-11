import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { SensitiveBanner } from "@/components/SensitiveBanner";
import { AccessReasonForm } from "@/components/AccessReasonForm";
import { NoteForm } from "@/components/NoteForm";
import { hasPermission, requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import {
  findActiveGrant,
  getAdminUserById,
  getConversationById,
  getUserById,
  listMessagesForConversation,
  listNotes,
  listReports,
} from "@/lib/data/store";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const session = await requirePermission("message.read.report_context");
  const convo = getConversationById(conversationId);
  if (!convo) notFound();

  const linkedReport = listReports({}).find((r) => r.conversationId === convo.id) ?? null;
  const grant = findActiveGrant(session.adminUserId, "conversation", convo.id);
  const canFull = hasPermission(session, "message.read.all");
  const canSeeFull = canFull && !!grant;

  if (!canFull && !linkedReport) {
    // Without an associated report or full message permission, cannot show messages.
    return (
      <>
        <PageHeader title={`Conversation ${convo.id}`} subtitle="Restricted view" />
        <div className="card p-4">
          <SensitiveBanner>
            This conversation has no associated report and your role does not include
            <code className="mx-1">message.read.all</code>. Access denied.
          </SensitiveBanner>
        </div>
      </>
    );
  }

  await writeAudit({
    session,
    eventType: "conversation.viewed",
    targetEntityType: "conversation",
    targetEntityId: convo.id,
    accessReason: grant?.reason ?? (linkedReport ? "active_report_investigation" : null),
    reportId: linkedReport?.id ?? null,
  });

  const messages = listMessagesForConversation(convo.id);
  const a = getUserById(convo.participantUserIds[0]);
  const b = getUserById(convo.participantUserIds[1]);
  const notes = listNotes("conversation", convo.id);

  // Without elevated permission, only show the report context window.
  let visibleMessages = messages;
  if (!canSeeFull && linkedReport) {
    const idx = linkedReport.reportedMessageId
      ? messages.findIndex((m) => m.id === linkedReport.reportedMessageId)
      : -1;
    if (idx >= 0) {
      visibleMessages = messages.slice(Math.max(0, idx - 3), Math.min(messages.length, idx + 4));
    } else {
      visibleMessages = messages.slice(-6);
    }
  }

  return (
    <>
      <PageHeader
        title={`Conversation ${convo.id}`}
        subtitle={`Match ${convo.matchId} · ${convo.participantUserIds.join(" ↔ ")}`}
      />
      <SensitiveBanner>
        {canSeeFull
          ? "Full conversation view enabled. This access expires soon."
          : "Showing report-context window only. Full conversation requires reason capture."}
      </SensitiveBanner>

      <div className="grid md:grid-cols-3 gap-6 mt-4">
        <section className="card p-4">
          <h2 className="font-semibold text-ink-700 mb-3">Participants</h2>
          {[a, b].map((u, i) =>
            u ? (
              <div key={u.id} className="mb-3">
                <Link href={`/users/${u.id}`} className="font-medium">{u.displayName}</Link>
                <div className="text-xs text-ink-500">{u.id}</div>
              </div>
            ) : (
              <div key={i} className="text-sm text-ink-500">
                {convo.participantUserIds[i]} (not found)
              </div>
            ),
          )}
          <div className="mt-3 text-xs text-ink-500">
            Created {new Date(convo.createdAt).toLocaleString()} · {convo.status}
          </div>
          {linkedReport ? (
            <div className="mt-3">
              <Link href={`/reports/${linkedReport.id}`} className="btn">
                Open linked report {linkedReport.id}
              </Link>
            </div>
          ) : null}
        </section>

        <section className="md:col-span-2 space-y-3">
          {!canSeeFull && canFull ? (
            <AccessReasonForm
              targetEntityType="conversation"
              targetEntityId={convo.id}
              redirectTo={`/conversations/${convo.id}`}
              reportId={linkedReport?.id ?? null}
              title="Open full conversation"
              description="Full conversation history outside the report context window requires a reason."
            />
          ) : null}

          <div className="card p-4">
            <h2 className="font-semibold text-ink-700 mb-3">Messages</h2>
            <ul className="space-y-2">
              {visibleMessages.map((m) => {
                const sender = getUserById(m.senderUserId);
                const isReported = linkedReport?.reportedMessageId === m.id;
                return (
                  <li
                    key={m.id}
                    className={`rounded-md border p-3 ${
                      isReported
                        ? "border-danger bg-danger-soft/40"
                        : "border-ink-200 bg-ink-50"
                    }`}
                  >
                    <div className="text-xs text-ink-500 flex justify-between">
                      <span>
                        {sender?.displayName ?? m.senderUserId} ·{" "}
                        {new Date(m.createdAt).toLocaleString()}
                      </span>
                      {isReported ? (
                        <span className="text-danger font-medium">reported</span>
                      ) : null}
                    </div>
                    <div className="text-sm mt-1">{m.body}</div>
                  </li>
                );
              })}
              {visibleMessages.length === 0 ? (
                <li className="text-sm text-ink-500">No messages.</li>
              ) : null}
            </ul>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold text-ink-700 mb-3">Internal notes</h2>
            {hasPermission(session, "note.write") ? (
              <NoteForm targetEntityType="conversation" targetEntityId={convo.id} />
            ) : null}
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
          </div>
        </section>
      </div>
    </>
  );
}
