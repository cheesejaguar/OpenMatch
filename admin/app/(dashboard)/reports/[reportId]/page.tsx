import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SensitiveBanner } from "@/components/SensitiveBanner";
import { ResolveReportForm } from "@/components/ResolveReportForm";
import { AssignReportForm } from "@/components/AssignReportForm";
import { NoteForm } from "@/components/NoteForm";
import { BanFormButton } from "@/components/BanModal";
import { hasPermission, requirePermission } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import {
  getAdminUserById,
  getMessageById,
  getReportById,
  getUserById,
  listAdminUsers,
  listMessagesForConversation,
  listNotes,
  listReportsByUserId,
} from "@/lib/data/store";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const session = await requirePermission("report.read.all");
  const report = getReportById(reportId);
  if (!report) notFound();

  await writeAudit({
    session,
    eventType: "report.viewed",
    targetEntityType: "report",
    targetEntityId: report.id,
    reportId: report.id,
    accessReason: "active_report_investigation",
  });

  const reporter = getUserById(report.reporterUserId);
  const reported = getUserById(report.reportedUserId);
  const reportedMessage = report.reportedMessageId
    ? getMessageById(report.reportedMessageId)
    : null;
  const conversationMessages = report.conversationId
    ? listMessagesForConversation(report.conversationId)
    : [];
  const reportedPhoto = reported && report.reportedPhotoId
    ? reported.photos.find((p) => p.id === report.reportedPhotoId)
    : null;

  const priorReports = reported ? listReportsByUserId(reported.id).filter((r) => r.id !== report.id) : [];
  const notes = listNotes("report", report.id);
  const admins = listAdminUsers().map((a) => ({ id: a.id, displayName: a.displayName }));

  // Locate context window: 3 messages before/after.
  const reportedIndex = reportedMessage
    ? conversationMessages.findIndex((m) => m.id === reportedMessage.id)
    : -1;
  const contextWindow =
    reportedIndex >= 0
      ? conversationMessages.slice(
          Math.max(0, reportedIndex - 3),
          Math.min(conversationMessages.length, reportedIndex + 4),
        )
      : conversationMessages;

  return (
    <>
      <PageHeader
        title={`Report ${report.id}`}
        subtitle={`${report.contentType} · ${report.reason.replaceAll("_", " ")}`}
        actions={
          reported && (hasPermission(session, "user.ban.temporary") || hasPermission(session, "user.ban.permanent")) ? (
            <BanFormButton
              userId={reported.id}
              displayName={reported.displayName}
              currentStatus={reported.status}
              canTemporary={hasPermission(session, "user.ban.temporary")}
              canPermanent={hasPermission(session, "user.ban.permanent")}
              reportId={report.id}
            />
          ) : null
        }
      />
      <div className="flex gap-2 flex-wrap mb-4">
        <StatusBadge value={report.status} />
        <StatusBadge value={report.severity} />
        <span className="text-xs text-ink-500">
          Created {new Date(report.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <section className="card p-4">
          <h2 className="font-semibold text-ink-700 mb-3">Reporter</h2>
          {reporter ? (
            <div>
              <Link href={`/users/${reporter.id}`} className="font-medium">
                {reporter.displayName}
              </Link>
              <div className="text-xs text-ink-500">{reporter.id}</div>
              <div className="text-sm mt-2">{reporter.bio}</div>
            </div>
          ) : (
            <div className="text-sm text-ink-500">Reporter not found.</div>
          )}
        </section>
        <section className="card p-4 md:col-span-2">
          <h2 className="font-semibold text-ink-700 mb-3">Reported user</h2>
          {reported ? (
            <div>
              <div className="flex justify-between items-start gap-3">
                <div>
                  <Link href={`/users/${reported.id}`} className="font-medium">
                    {reported.displayName}
                  </Link>
                  <div className="text-xs text-ink-500">
                    {reported.id} · {reported.city ?? "—"} · age {reported.age}
                  </div>
                </div>
                <div className="flex gap-1">
                  <StatusBadge value={reported.status} />
                  <StatusBadge value={reported.moderationStatus} />
                </div>
              </div>
              <p className="text-sm mt-2">{reported.bio}</p>
            </div>
          ) : (
            <div className="text-sm text-ink-500">Reported user not found.</div>
          )}
        </section>
      </div>

      <section className="card p-4 mt-6">
        <h2 className="font-semibold text-ink-700 mb-3">Report details</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="label">Reason</div>
            <div className="text-sm">{report.reason.replaceAll("_", " ")}</div>
          </div>
          <div>
            <div className="label">Content type</div>
            <div className="text-sm">{report.contentType}</div>
          </div>
          <div className="md:col-span-2">
            <div className="label">Reporter notes</div>
            <div className="text-sm">{report.details ?? "—"}</div>
          </div>
        </div>
      </section>

      {report.contentType === "photo" && reportedPhoto ? (
        <section className="card p-4 mt-6">
          <h2 className="font-semibold text-ink-700 mb-3">Reported photo</h2>
          <div className="aspect-[3/4] max-w-xs bg-ink-100 grid place-items-center text-ink-400 text-sm border rounded-md">
            Photo preview #{reportedPhoto.sortOrder}
          </div>
          <div className="mt-2 text-xs">
            <StatusBadge value={reportedPhoto.moderationStatus} /> · {reportedPhoto.id}
          </div>
        </section>
      ) : null}

      {report.contentType === "message" && report.conversationId ? (
        <section className="card p-4 mt-6">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold text-ink-700">Reported message context</h2>
            <Link href={`/conversations/${report.conversationId}`} className="text-sm">
              Open full conversation →
            </Link>
          </div>
          <SensitiveBanner>
            Showing report-context messages only. Full conversation requires a separate
            access reason.
          </SensitiveBanner>
          <ul className="mt-3 space-y-2">
            {contextWindow.length === 0 ? (
              <li className="text-sm text-ink-500">No context messages available.</li>
            ) : null}
            {contextWindow.map((m) => {
              const sender = getUserById(m.senderUserId);
              const isReported = reportedMessage?.id === m.id;
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
                      <span className="text-danger font-medium">reported message</span>
                    ) : null}
                  </div>
                  <div className="text-sm mt-1">{m.body}</div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <section className="card p-4">
          <h2 className="font-semibold text-ink-700 mb-3">Action panel</h2>
          {hasPermission(session, "report.assign") ? (
            <div className="mb-4">
              <AssignReportForm
                reportId={report.id}
                admins={admins}
                current={report.assignedAdminUserId}
                canAssign
              />
            </div>
          ) : null}
          <ResolveReportForm
            reportId={report.id}
            canResolve={hasPermission(session, "report.resolve")}
          />
        </section>

        <section className="card p-4">
          <h2 className="font-semibold text-ink-700 mb-3">Prior reports about this user</h2>
          {priorReports.length === 0 ? (
            <div className="text-sm text-ink-500">No prior reports.</div>
          ) : (
            <table>
              <thead>
                <tr><th>ID</th><th>Reason</th><th>Status</th><th>When</th></tr>
              </thead>
              <tbody>
                {priorReports.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/reports/${p.id}`}>{p.id}</Link></td>
                    <td>{p.reason.replaceAll("_", " ")}</td>
                    <td><StatusBadge value={p.status} /></td>
                    <td className="text-ink-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card p-4 mt-6">
        <h2 className="font-semibold text-ink-700 mb-3">Internal notes</h2>
        {hasPermission(session, "note.write") ? (
          <NoteForm targetEntityType="report" targetEntityId={report.id} />
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
      </section>
    </>
  );
}
